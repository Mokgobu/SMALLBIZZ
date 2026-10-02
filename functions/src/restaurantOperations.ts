import { Timestamp, getFirestore, type Firestore } from 'firebase-admin/firestore'
import { HttpsError } from 'firebase-functions/v2/https'
import { requireBusinessRole, type AuthContext } from './businessAccess.js'
import { assertRecipeProductReferences, canTransitionKitchenStatus, nextRecipeVersion, parseRecipe, recipeAvailability, type RestaurantProduct } from './restaurantDomain.js'
import { businessDateKey, daysUntilExpiry } from './expiryDomain.js'
import { convertQuantity, normalizeUnit } from './unitsDomain.js'

const fail = (error: unknown): never => { if (error instanceof HttpsError) throw error; throw new HttpsError('invalid-argument', error instanceof Error ? error.message : 'The request is invalid.') }
const RECIPE_MANAGERS = ['owner', 'manager', 'supervisor'] as const
const KITCHEN_VIEWERS = ['owner', 'manager', 'supervisor', 'cashier'] as const
const KITCHEN_MANAGERS = ['owner', 'manager', 'supervisor'] as const
const COST_VIEWERS = ['owner', 'manager'] as const
const emptyRequest = (data: unknown) => { if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data as object).length) throw new HttpsError('invalid-argument', 'This request does not accept fields.') }
const productShape = (doc: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot): RestaurantProduct => { const data = doc.data() ?? {}; return { id: doc.id, name: String(data.name ?? ''), quantity: Number(data.quantity ?? 0), trackStock: data.trackStock === true, status: String(data.status ?? ''), unit: String(data.unit ?? 'each'), costPrice: Number(data.costPrice ?? 0), sellingPrice: Number(data.sellingPrice ?? 0), productClass: String(data.productClass ?? 'inventory_item'), menuItem: data.menuItem === true, recipeId: typeof data.recipeId === 'string' ? data.recipeId : null, tracksExpiry: data.tracksExpiry === true, isIngredient: data.isIngredient === true } }

export async function listRecipesForRequest(data: unknown, auth: AuthContext | undefined, db: Firestore = getFirestore(), now = Timestamp.now()) {
  emptyRequest(data)
  const caller = await requireBusinessRole(auth, RECIPE_MANAGERS, db, now)
  const [recipeSnapshot, productSnapshot] = await Promise.all([caller.businessRef.collection('recipes').limit(200).get(), caller.businessRef.collection('products').limit(500).get()])
  const canViewCost = caller.role === 'owner' || caller.role === 'manager'
  const products = productSnapshot.docs.map(productShape)
  return {
    recipes: recipeSnapshot.docs.map((doc) => { const value = parseRecipe({ id: doc.id, ...doc.data() }, String(doc.data().productId ?? doc.id)); return { ...value, createdAt: doc.data().createdAt?.toMillis?.() ?? null, updatedAt: doc.data().updatedAt?.toMillis?.() ?? null } }),
    products: products.map((product) => { if (canViewCost) return product; const { costPrice: _costPrice, ...safeProduct } = product; return safeProduct }),
    financialValuesIncluded: canViewCost
  }
}

export async function saveRecipeForRequest(data: unknown, auth: AuthContext | undefined, db: Firestore = getFirestore(), now = Timestamp.now()) {
  const caller = await requireBusinessRole(auth, RECIPE_MANAGERS, db, now)
  let requested
  try { requested = parseRecipe(data, String((data as Record<string, unknown>)?.productId ?? '')) } catch (error) { return fail(error) }
  const recipeRef = caller.businessRef.collection('recipes').doc(requested.productId)
  return db.runTransaction(async (transaction) => {
    const existing = await transaction.get(recipeRef)
    const menuProductRef = caller.businessRef.collection('products').doc(requested.productId)
    const menuProductDoc = await transaction.get(menuProductRef)
    if (!menuProductDoc.exists) throw new HttpsError('invalid-argument', 'The selected menu item does not belong to this business.')
    const ingredientIds = [...new Set([...requested.ingredients, ...requested.modifierGroups.flatMap((group) => group.options.flatMap((option) => option.ingredientAdjustments))].map((row) => row.ingredientProductId))]
    const ingredientDocs = await Promise.all(ingredientIds.map((id) => transaction.get(caller.businessRef.collection('products').doc(id))))
    const products = new Map<string, RestaurantProduct>(ingredientDocs.filter((doc) => doc.exists).map((doc) => [doc.id, productShape(doc)]))
    const menuProduct = productShape(menuProductDoc)
    try { assertRecipeProductReferences(requested, menuProduct, products) } catch (error) { return fail(error) }
    const version = nextRecipeVersion(existing.exists ? Number(existing.data()?.version ?? 0) : null)
    const recipe = { productId: requested.productId, nameSnapshot: menuProduct.name, version, active: requested.active, ingredients: requested.ingredients, modifierGroups: requested.modifierGroups, updatedAt: now, updatedBy: caller.uid, ...(existing.exists ? { createdAt: existing.data()?.createdAt ?? now, createdBy: existing.data()?.createdBy ?? caller.uid } : { createdAt: now, createdBy: caller.uid }) }
    const versionRef = caller.businessRef.collection('recipeVersions').doc(`${requested.productId}_v${version}`)
    transaction.create(versionRef, { ...recipe, recipeId: requested.productId, immutable: true })
    transaction.set(recipeRef, recipe)
    transaction.update(menuProductRef, { recipeId: requested.productId, menuItem: true, productClass: 'menu_item', updatedAt: now })
    transaction.create(caller.businessRef.collection('staffActivity').doc(), { type: existing.exists ? 'recipe_updated' : 'recipe_created', actorUid: caller.uid, targetUid: caller.uid, actorName: caller.displayName, targetName: menuProduct.name, description: `${caller.displayName} saved ${menuProduct.name} recipe version ${version}.`, recipeId: requested.productId, recipeVersion: version, createdAt: now })
    return { recipeId: requested.productId, version }
  })
}

export async function getMenuCatalogForRequest(data: unknown, auth: AuthContext | undefined, db: Firestore = getFirestore(), now = Timestamp.now()) {
  emptyRequest(data)
  const caller = await requireBusinessRole(auth, KITCHEN_VIEWERS, db, now)
  const [recipeSnapshot, productSnapshot, batchSnapshot] = await Promise.all([caller.businessRef.collection('recipes').limit(200).get(), caller.businessRef.collection('products').limit(500).get(), caller.businessRef.collection('inventoryBatches').where('status', '==', 'active').limit(1000).get()])
  const products = productSnapshot.docs.map(productShape), productsById = new Map(products.map((product) => [product.id, product]))
  const today = businessDateKey(now.toDate()), batchTotals = new Map<string, number>()
  for (const doc of batchSnapshot.docs) { const batch = doc.data(), quantity = Number(batch.quantityRemaining ?? 0), expiryDate = typeof batch.expiryDate === 'string' ? batch.expiryDate : null; if (quantity > 0 && (!expiryDate || daysUntilExpiry(expiryDate, today) >= 0)) batchTotals.set(String(batch.productId), (batchTotals.get(String(batch.productId)) ?? 0) + quantity) }
  for (const product of products) if (product.tracksExpiry) product.quantity = Number((batchTotals.get(product.id) ?? 0).toFixed(6))
  return {
    items: recipeSnapshot.docs.map((doc) => { const recipe = parseRecipe({ id: doc.id, ...doc.data() }, String(doc.data().productId ?? doc.id)); const availability = recipeAvailability(recipe, productsById); return { productId: recipe.productId, recipeId: doc.id, recipeVersion: recipe.version, modifierGroups: recipe.modifierGroups, ...availability } })
  }
}

export async function getRecipeCostPreviewForRequest(data: unknown, auth: AuthContext | undefined, db: Firestore = getFirestore(), now = Timestamp.now()) {
  const caller = await requireBusinessRole(auth, COST_VIEWERS, db, now)
  const recipeId = typeof (data as Record<string, unknown>)?.recipeId === 'string' ? String((data as Record<string, unknown>).recipeId).trim() : ''
  if (!recipeId) throw new HttpsError('invalid-argument', 'Choose a recipe.')
  const recipeDoc = await caller.businessRef.collection('recipes').doc(recipeId).get()
  if (!recipeDoc.exists) throw new HttpsError('not-found', 'Recipe was not found.')
  const recipe = parseRecipe({ id: recipeDoc.id, ...recipeDoc.data() }, String(recipeDoc.data()?.productId ?? recipeId))
  const ids = [...new Set(recipe.ingredients.map((row) => row.ingredientProductId))]
  const [menuDoc, ...ingredientDocs] = await Promise.all([caller.businessRef.collection('products').doc(recipe.productId).get(), ...ids.map((id) => caller.businessRef.collection('products').doc(id).get())])
  const lines = recipe.ingredients.map((ingredient, index) => { if (!ingredientDocs[index].exists) throw new HttpsError('failed-precondition', `Ingredient ${ingredient.ingredientNameSnapshot} is unavailable.`); const product = productShape(ingredientDocs[index]), stockQuantity = convertQuantity(ingredient.quantity, ingredient.unit, normalizeUnit(product.unit ?? 'each')), lineCost = Math.round(stockQuantity * Number(product.costPrice ?? 0) * 100) / 100; return { ingredientProductId: product.id, ingredientName: product.name, quantity: ingredient.quantity, unit: ingredient.unit, unitCost: product.costPrice ?? 0, lineCost } })
  const totalCost = Math.round(lines.reduce((sum, line) => sum + line.lineCost, 0) * 100) / 100, sellingPrice = Number(menuDoc.data()?.sellingPrice ?? 0), margin = Math.round((sellingPrice - totalCost) * 100) / 100
  return { recipeId, version: recipe.version, lines, totalCost, sellingPrice, margin, marginPercent: sellingPrice ? Math.round(margin / sellingPrice * 10000) / 100 : 0 }
}

export async function listKitchenOrdersForRequest(data: unknown, auth: AuthContext | undefined, db: Firestore = getFirestore(), now = Timestamp.now()) {
  emptyRequest(data)
  const caller = await requireBusinessRole(auth, KITCHEN_VIEWERS, db, now)
  const snapshot = await caller.businessRef.collection('kitchenOrders').orderBy('createdAt', 'desc').limit(100).get()
  return { orders: snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data(), createdAt: doc.data().createdAt?.toMillis?.() ?? null, updatedAt: doc.data().updatedAt?.toMillis?.() ?? null })) }
}

export async function updateKitchenOrderStatusForRequest(data: unknown, auth: AuthContext | undefined, db: Firestore = getFirestore(), now = Timestamp.now()) {
  const caller = await requireBusinessRole(auth, KITCHEN_MANAGERS, db, now), value = data as Record<string, unknown>
  const orderId = typeof value?.orderId === 'string' ? value.orderId.trim() : '', nextStatus = typeof value?.status === 'string' ? value.status.trim() : ''
  if (!orderId || !['preparing', 'ready', 'completed'].includes(nextStatus)) throw new HttpsError('invalid-argument', 'Choose a valid kitchen status update.')
  const orderRef = caller.businessRef.collection('kitchenOrders').doc(orderId)
  return db.runTransaction(async (transaction) => { const order = await transaction.get(orderRef); if (!order.exists) throw new HttpsError('not-found', 'Kitchen order was not found.'); const previousStatus = String(order.data()?.status ?? ''); if (!canTransitionKitchenStatus(previousStatus, nextStatus)) throw new HttpsError('failed-precondition', `Kitchen order cannot move from ${previousStatus} to ${nextStatus}.`); transaction.update(orderRef, { status: nextStatus, updatedAt: now }); const auditRef = caller.businessRef.collection('kitchenOrderActivity').doc(); transaction.create(auditRef, { orderId, previousStatus, newStatus: nextStatus, staffUid: caller.uid, staffNameSnapshot: caller.displayName, timestamp: now }); return { orderId, status: nextStatus } })
}
