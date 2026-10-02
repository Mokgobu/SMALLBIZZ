import { getApps, initializeApp } from 'firebase-admin/app'
import { FieldPath, FieldValue, Timestamp, getFirestore, type Firestore } from 'firebase-admin/firestore'
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { johannesburgDateKey, prepareAuthoritativeSale, SaleInputError, validateSaleIntent, type AuthoritativeProduct } from './domain.js'
import { allocateFefo, type FefoBatch } from './inventoryDomain.js'
import { normalizeOperationsSettings } from './operationsSettings.js'
import { derivePromotionStatus, manualDiscountLimit, promotionDiscount } from './promotionDomain.js'
import { aggregateIngredientStockUpdates, kitchenItemsForSale, parseRecipe, resolveRecipeLine, type RecipeDocument, type RestaurantProduct } from './restaurantDomain.js'

if (getApps().length === 0) initializeApp()

type AuthContext = NonNullable<CallableRequest<unknown>['auth']>

function asMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unable to create the sale.'
}

function activeTrial(data: FirebaseFirestore.DocumentData, now: Timestamp) {
  if (data.accountStatus === 'ACTIVE') return true
  return data.accountStatus === 'TRIAL'
    && data.trialEndsAt instanceof Timestamp
    && data.trialEndsAt.toMillis() > now.toMillis()
}

export function resolveCashierSnapshot(
  membership: FirebaseFirestore.DocumentData | undefined,
  profile: FirebaseFirestore.DocumentData,
  token: Record<string, unknown>,
  staffRole: string
) {
  const name = typeof membership?.displayName === 'string' && membership.displayName.trim()
    ? membership.displayName.trim()
    : typeof profile.fullName === 'string' && profile.fullName.trim()
      ? profile.fullName.trim()
      : typeof token.name === 'string' && token.name.trim()
        ? token.name.trim()
        : null
  return { cashierNameSnapshot: name, cashierRoleSnapshot: staffRole }
}

export async function createSaleForRequest(
  data: unknown,
  auth: AuthContext | undefined,
  db: Firestore = getFirestore(),
  now: Timestamp = Timestamp.now()
) {
  if (!auth?.uid) throw new HttpsError('unauthenticated', 'Sign in before recording a sale.')

  let intent
  try {
    intent = validateSaleIntent(data)
  } catch (error) {
    throw new HttpsError('invalid-argument', asMessage(error))
  }

  try {
    return await db.runTransaction(async (transaction) => {
      const profileRef = db.doc(`users/${auth.uid}`)
      const profileSnapshot = await transaction.get(profileRef)
      if (!profileSnapshot.exists) throw new HttpsError('failed-precondition', 'Your user profile is unavailable.')
      const profile = profileSnapshot.data()!
      if (profile.accountStatus !== 'ACTIVE') throw new HttpsError('permission-denied', 'Your account is not active.')
      const linkedBusinessId = profile.linkedBusinessId ?? profile.businessId
      const businessId = typeof linkedBusinessId === 'string' ? linkedBusinessId.trim() : ''
      if (!businessId) throw new HttpsError('failed-precondition', 'Your account is not linked to a business.')

      const businessRef = db.doc(`businesses/${businessId}`)
      const businessSnapshot = await transaction.get(businessRef)
      if (!businessSnapshot.exists) throw new HttpsError('failed-precondition', 'The linked business is unavailable.')
      const business = businessSnapshot.data()!
      const membershipRef = businessRef.collection('members').doc(auth.uid)
      const membershipSnapshot = await transaction.get(membershipRef)
      const legacyOwner = !membershipSnapshot.exists
        && business.ownerUid === auth.uid
        && Array.isArray(business.memberUids)
        && business.memberUids.includes(auth.uid)
      const membership = membershipSnapshot.data()
      if (!legacyOwner && (!membershipSnapshot.exists || membership?.status !== 'active')) {
        throw new HttpsError('permission-denied', 'You are not permitted to access this business.')
      }
      const staffRole = legacyOwner ? 'owner' : membership?.role
      if (!['owner', 'manager', 'supervisor', 'cashier'].includes(staffRole)) {
        throw new HttpsError('permission-denied', 'Your staff role cannot create sales.')
      }
      if (!activeTrial(business, now)) throw new HttpsError('permission-denied', 'The business account or trial is not active.')

      const settingsSnapshot = await transaction.get(businessRef.collection('settings').doc('operations'))
      const operationsSettings = normalizeOperationsSettings(settingsSnapshot.data())

      let customerId: string | null = null
      let customerNameSnapshot: string | null = null
      if (intent.customerId) {
        const customerSnapshot = await transaction.get(businessRef.collection('customers').doc(intent.customerId))
        if (!customerSnapshot.exists) throw new HttpsError('invalid-argument', 'The selected customer does not exist.')
        const customer = customerSnapshot.data()!
        if (customer.status !== 'active') throw new HttpsError('invalid-argument', 'Choose an active customer.')
        customerId = customerSnapshot.id
        customerNameSnapshot = typeof customer.displayName === 'string' && customer.displayName.trim()
          ? customer.displayName.trim()
          : null
      }

      const productRefs = intent.items.map((line) => businessRef.collection('products').doc(line.productId))
      const productSnapshots = await Promise.all(productRefs.map((ref) => transaction.get(ref)))
      const products: AuthoritativeProduct[] = productSnapshots.map((snapshot) => {
        if (!snapshot.exists) throw new HttpsError('invalid-argument', 'A selected product does not exist in this business.')
        const product = snapshot.data()!
        return {
          id: snapshot.id,
          name: typeof product.name === 'string' ? product.name : '',
          sku: typeof product.sku === 'string' ? product.sku : '',
          sellingPrice: product.sellingPrice,
          costPrice: product.costPrice,
          quantity: product.quantity,
          trackStock: product.trackStock === true,
          status: product.status,
          category: typeof product.category === 'string' ? product.category : '',
          tracksExpiry: product.tracksExpiry === true,
          productClass: typeof product.productClass === 'string' ? product.productClass : undefined,
          menuItem: product.menuItem === true,
          recipeId: typeof product.recipeId === 'string' ? product.recipeId : null,
          isIngredient: product.isIngredient === true,
          unit: typeof product.unit === 'string' ? product.unit : undefined
        }
      })

      const selectedProductsById = new Map(products.map((product) => [product.id, product]))
      const menuProducts = [...selectedProductsById.values()].filter((product) => product.menuItem || product.productClass === 'menu_item' || Boolean(product.recipeId))
      const recipeRefs = menuProducts.map((product) => businessRef.collection('recipes').doc(product.recipeId ?? product.id))
      const recipeSnapshots = await Promise.all(recipeRefs.map((ref) => transaction.get(ref)))
      const recipeDocuments = new Map<string, RecipeDocument>()
      for (const [index, snapshot] of recipeSnapshots.entries()) {
        const product = menuProducts[index]
        if (!snapshot.exists) {
          throw new HttpsError('failed-precondition', 'The selected menu item recipe is unavailable.')
        }
        recipeDocuments.set(product.id, parseRecipe(snapshot.data(), product.id))
      }

      const ingredientIds = [...new Set([...recipeDocuments.values()].flatMap((recipe) => [
        ...recipe.ingredients.map((ingredient) => ingredient.ingredientProductId),
        ...recipe.modifierGroups.flatMap((group) => group.options.flatMap((option) => option.ingredientAdjustments.map((adjustment) => adjustment.ingredientProductId)))
      ]))]
      const ingredientSnapshots = await Promise.all(ingredientIds.map((id) => transaction.get(businessRef.collection('products').doc(id))))
      const restaurantProducts = new Map<string, RestaurantProduct>([...selectedProductsById.values()].map((product) => [product.id, product]))
      for (const snapshot of ingredientSnapshots) {
        if (!snapshot.exists) throw new HttpsError('failed-precondition', `Recipe ingredient ${snapshot.id} is missing from this business.`)
        const product = snapshot.data()!
        restaurantProducts.set(snapshot.id, {
          id: snapshot.id, name: String(product.name ?? ''), quantity: Number(product.quantity ?? 0),
          trackStock: product.trackStock === true, status: String(product.status ?? ''), unit: String(product.unit ?? 'each'),
          costPrice: Number(product.costPrice ?? 0), sellingPrice: Number(product.sellingPrice ?? 0),
          productClass: String(product.productClass ?? 'inventory_item'), menuItem: product.menuItem === true,
          recipeId: typeof product.recipeId === 'string' ? product.recipeId : null, tracksExpiry: product.tracksExpiry === true,
          isIngredient: product.isIngredient === true
        })
      }
      let resolvedMenuLines
      try {
        resolvedMenuLines = intent.items.map((line) => {
          const product = selectedProductsById.get(line.productId)!
          const recipe = recipeDocuments.get(line.productId)
          if (!recipe) return null
          const resolved = resolveRecipeLine(recipe, line.quantity, line.modifierOptionIds, restaurantProducts)
          const totalRecipeCost = resolved.requirements.reduce((sum, requirement) => sum + requirement.stockQuantity * Number(requirement.product.costPrice ?? 0), 0)
          return { ...resolved, product, unitCost: Math.round(totalRecipeCost / line.quantity * 100) / 100 }
        })
      } catch (error) {
        throw new HttpsError('invalid-argument', asMessage(error))
      }

      let appliedPromotion: FirebaseFirestore.DocumentData | null = null
      let appliedPromotionId: string | null = null
      let promotionAmount = 0
      if (intent.promotionId) {
        const promotionSnapshot = await transaction.get(businessRef.collection('promotions').doc(intent.promotionId))
        if (!promotionSnapshot.exists) throw new HttpsError('invalid-argument', 'The selected promotion does not exist in this business.')
        const candidate = promotionSnapshot.data()!
        const startsAt = candidate.startsAt instanceof Timestamp ? candidate.startsAt.toMillis() : 0
        const endsAt = candidate.endsAt instanceof Timestamp ? candidate.endsAt.toMillis() : 0
        if (derivePromotionStatus(candidate.status, startsAt, endsAt, now.toMillis()) !== 'active') throw new HttpsError('failed-precondition', 'The selected promotion is not currently active.')
        try {
          promotionAmount = promotionDiscount(candidate as never, intent.items.map((line, index) => {
            const product = selectedProductsById.get(line.productId)!
            return { productId: product.id, category: typeof product.category === 'string' ? product.category : '', quantity: line.quantity, unitPrice: product.sellingPrice + Number(resolvedMenuLines[index]?.unitPriceDelta ?? 0) }
          }))
        } catch (error) { throw new HttpsError('failed-precondition', asMessage(error)) }
        appliedPromotion = candidate; appliedPromotionId = promotionSnapshot.id
      }

      const batchAllocations = new Map<string, ReturnType<typeof allocateFefo>>()
      const directQuantities = new Map<string, number>()
      for (const line of intent.items) directQuantities.set(line.productId, (directQuantities.get(line.productId) ?? 0) + line.quantity)
      for (const [productId, quantity] of directQuantities) {
        const product = selectedProductsById.get(productId)!
        if (recipeDocuments.has(product.id)) continue
        if (!product.trackStock || !product.tracksExpiry) continue
        const batchesSnapshot = await transaction.get(businessRef.collection('inventoryBatches').where('productId', '==', product.id).where('status', '==', 'active').orderBy('expiryDate').orderBy(FieldPath.documentId()).limit(200))
        const batches = batchesSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as FefoBatch)
        try { batchAllocations.set(product.id, allocateFefo(batches, quantity, johannesburgDateKey(now.toDate()))) }
        catch (error) { throw new HttpsError('failed-precondition', `${product.name}: ${asMessage(error)}`) }
      }

      let prepared
      try {
        prepared = prepareAuthoritativeSale([...selectedProductsById.values()].map((product) => recipeDocuments.has(product.id) ? { ...product, trackStock: false } : product), intent, {
          manualDiscountLimitRate: manualDiscountLimit(staffRole, operationsSettings.discountLimits) / 100,
          promotionDiscount: promotionAmount,
          lineAdjustments: resolvedMenuLines.map((resolved) => resolved ? { unitPriceDelta: resolved.unitPriceDelta, unitCostOverride: resolved.unitCost, modifierSnapshots: resolved.modifierSnapshots, recipeSnapshot: resolved.recipeSnapshot, menuItem: true } : {})
        })
      } catch (error) {
        throw new HttpsError('invalid-argument', asMessage(error))
      }

      const menuIngredientStockUpdates = aggregateIngredientStockUpdates(resolvedMenuLines.filter((line): line is NonNullable<typeof line> => Boolean(line)))
      const directUpdatesByProduct = new Map(prepared.stockUpdates.map((update) => [update.product.id, update]))
      for (const update of menuIngredientStockUpdates) {
        const direct = directUpdatesByProduct.get(update.product.id)
        if (!direct) continue
        if (update.product.tracksExpiry) throw new HttpsError('failed-precondition', `${update.product.name} cannot be sold directly and consumed by a recipe in the same sale. Split these into two sales so FEFO allocation remains auditable.`)
        update.quantityBefore = direct.quantityAfter
        update.quantityAfter = Number((direct.quantityAfter - update.quantityConsumed).toFixed(6))
        if (update.quantityAfter < 0) throw new HttpsError('failed-precondition', `Insufficient stock for ${update.product.name}.`)
      }
      const ingredientBatchAllocations = new Map<string, ReturnType<typeof allocateFefo>>()
      for (const update of menuIngredientStockUpdates) {
        const product = update.product
        if (!product.trackStock || !product.tracksExpiry) continue
        const batchesSnapshot = await transaction.get(businessRef.collection('inventoryBatches').where('productId', '==', product.id).where('status', '==', 'active').orderBy('expiryDate').orderBy(FieldPath.documentId()).limit(200))
        const batches = batchesSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as FefoBatch)
        try {
          ingredientBatchAllocations.set(product.id, allocateFefo(batches, update.quantityConsumed, johannesburgDateKey(now.toDate())))
        } catch (error) {
          throw new HttpsError('failed-precondition', `${product.name}: ${asMessage(error)}`)
        }
      }

      let totalCostCents = Math.round(prepared.totalCost * 100)
      for (const [productId, allocations] of batchAllocations) {
        if (!allocations) continue
        const matchingItems = prepared.items.filter((item) => item.productId === productId)
        const totalQuantity = matchingItems.reduce((sum, item) => sum + item.quantity, 0)
        const oldCost = matchingItems.reduce((sum, item) => sum + Math.round(item.costPrice * 100) * item.quantity, 0)
        const batchCost = allocations.reduce((sum, allocation) => sum + Math.round(allocation.costPriceSnapshot * 100) * allocation.quantity, 0)
        totalCostCents += batchCost - oldCost
        const averageCost = Math.round(batchCost / totalQuantity) / 100
        for (const item of matchingItems) item.costPrice = averageCost
      }
      prepared.totalCost = Math.round(totalCostCents) / 100
      prepared.grossProfit = Math.round((prepared.total - prepared.totalCost) * 100) / 100

      const saleRef = businessRef.collection('sales').doc()
      const cashierSnapshot = resolveCashierSnapshot(membership, profile, auth.token, staffRole)
      const sale = {
        items: prepared.items,
        itemCount: prepared.itemCount,
        subtotal: prepared.subtotal,
        discount: prepared.discount,
        manualDiscount: prepared.manualDiscount,
        promotionDiscount: prepared.promotionDiscount,
        promotionId: appliedPromotionId,
        promotionNameSnapshot: appliedPromotion ? String(appliedPromotion.name ?? '') : null,
        promotionTypeSnapshot: appliedPromotion ? String(appliedPromotion.type ?? '') : null,
        total: prepared.total,
        totalCost: prepared.totalCost,
        grossProfit: prepared.grossProfit,
        paymentMethod: prepared.paymentMethod,
        notes: prepared.notes,
        customerId,
        customerNameSnapshot,
        ...cashierSnapshot,
        createdAt: now,
        createdBy: auth.uid
      }
      transaction.create(saleRef, sale)
      const kitchenItems = kitchenItemsForSale(prepared.items)
      if (kitchenItems.length) {
        transaction.create(businessRef.collection('kitchenOrders').doc(saleRef.id), {
          orderNumber: saleRef.id.slice(-6).toUpperCase(), saleId: saleRef.id, status: 'new', items: kitchenItems,
          cashierUid: auth.uid, cashierNameSnapshot: cashierSnapshot.cashierNameSnapshot, createdAt: now, updatedAt: now
        })
        transaction.create(businessRef.collection('kitchenOrderActivity').doc(), {
          orderId: saleRef.id, previousStatus: null, newStatus: 'new', staffUid: auth.uid,
          staffNameSnapshot: cashierSnapshot.cashierNameSnapshot, timestamp: now
        })
      }
      if (membershipSnapshot.exists) transaction.update(membershipRef, { lastActiveAt: now })

      for (const update of prepared.stockUpdates) {
        const productRef = businessRef.collection('products').doc(update.product.id)
        const movementRef = businessRef.collection('inventoryMovements').doc(`${saleRef.id}_${update.product.id}`)
        transaction.update(productRef, {
          quantity: update.quantityAfter,
          lastMovementId: movementRef.id,
          updatedAt: now
        })
        const allocations = batchAllocations.get(update.product.id) ?? []
        for (const allocation of allocations) {
          transaction.update(businessRef.collection('inventoryBatches').doc(allocation.batchId), {
            quantityRemaining: allocation.quantityAfter,
            status: allocation.quantityAfter === 0 ? 'depleted' : 'active',
            updatedAt: now
          })
        }
        transaction.create(movementRef, {
          productId: update.product.id,
          productName: update.product.name,
          type: 'sale',
          quantityChange: update.quantityAfter - update.quantityBefore,
          quantityBefore: update.quantityBefore,
          quantityAfter: update.quantityAfter,
          reason: 'Stock deducted by sale',
          referenceId: saleRef.id,
          batchId: allocations.length === 1 ? allocations[0].batchId : null,
          batchAllocations: allocations.map((allocation) => ({ batchId: allocation.batchId, quantity: allocation.quantity, expiryDate: allocation.expiryDate })),
          notes: '',
          staffNameSnapshot: cashierSnapshot.cashierNameSnapshot,
          createdAt: now,
          createdBy: auth.uid
        })
      }

      const ingredientStockUpdates = menuIngredientStockUpdates
      for (const update of ingredientStockUpdates) {
        const productRef = businessRef.collection('products').doc(update.product.id)
        const movementRef = businessRef.collection('inventoryMovements').doc(`${saleRef.id}_${update.product.id}_ingredient`)
        transaction.update(productRef, {
          quantity: update.quantityAfter,
          lastMovementId: movementRef.id,
          updatedAt: now
        })
        const ingredientAllocations = ingredientBatchAllocations.get(update.product.id) ?? []
        for (const allocation of ingredientAllocations) {
          transaction.update(businessRef.collection('inventoryBatches').doc(allocation.batchId), {
            quantityRemaining: allocation.quantityAfter,
            status: allocation.quantityAfter === 0 ? 'depleted' : 'active',
            updatedAt: now
          })
        }
        transaction.create(movementRef, {
          productId: update.product.id,
          productName: update.product.name,
          type: 'recipe_consumption',
          quantityChange: update.quantityAfter - update.quantityBefore,
          quantityBefore: update.quantityBefore,
          quantityAfter: update.quantityAfter,
          reason: 'Ingredient consumed by menu sale',
          referenceId: saleRef.id,
          batchId: ingredientAllocations.length === 1 ? ingredientAllocations[0].batchId : null,
          batchAllocations: ingredientAllocations.map((allocation) => ({ batchId: allocation.batchId, quantity: allocation.quantity, expiryDate: allocation.expiryDate })),
          notes: 'Recipe ingredient consumption',
          unit: update.product.unit ?? 'each',
          menuItems: resolvedMenuLines.filter((line): line is NonNullable<typeof line> => line !== null).filter((line) => line.requirements.some((requirement) => requirement.product.id === update.product.id)).map((line) => ({ productId: line.product.id, productName: line.product.name, recipeVersion: line.recipeSnapshot.version })),
          staffNameSnapshot: cashierSnapshot.cashierNameSnapshot,
          createdAt: now,
          createdBy: auth.uid
        })
      }

      const date = johannesburgDateKey(now.toDate())
      transaction.set(businessRef.collection('dailyMetrics').doc(date), {
        date,
        grossSales: FieldValue.increment(prepared.subtotal),
        discounts: FieldValue.increment(prepared.discount),
        netSales: FieldValue.increment(prepared.total),
        cogs: FieldValue.increment(prepared.totalCost),
        grossProfitEstimate: FieldValue.increment(prepared.grossProfit),
        transactionCount: FieldValue.increment(1),
        unitsSold: FieldValue.increment(prepared.itemCount),
        updatedAt: now
      }, { merge: true })

      return {
        saleId: saleRef.id,
        receipt: { id: saleRef.id, ...sale, createdAt: now.toMillis() }
      }
    })
  } catch (error) {
    if (error instanceof HttpsError) throw error
    if (error instanceof SaleInputError) throw new HttpsError('invalid-argument', error.message)
    console.error('createSale failed', error)
    throw new HttpsError('internal', 'The sale could not be completed. No changes were saved.')
  }
}
