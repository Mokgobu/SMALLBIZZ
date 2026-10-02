import { Timestamp, getFirestore, type Firestore } from 'firebase-admin/firestore'
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { auditData } from './staffAdmin.js'
import { businessDateKey } from './expiryDomain.js'

type AuthContext = NonNullable<CallableRequest<unknown>['auth']>

async function requireOperational(auth: AuthContext | undefined, db: Firestore, roles: string[] = ['owner', 'manager', 'supervisor']) {
  if (!auth?.uid) throw new HttpsError('unauthenticated', 'Sign in to view operational data.')
  const profile = await db.doc(`users/${auth.uid}`).get()
  const profileData = profile.data() ?? {}
  if (profileData.accountStatus !== 'ACTIVE') throw new HttpsError('permission-denied', 'Your account is not active.')
  const businessId = String(profileData.linkedBusinessId ?? profileData.businessId ?? '')
  const businessRef = db.doc(`businesses/${businessId}`)
  const [business, membership] = await Promise.all([businessRef.get(), businessRef.collection('members').doc(auth.uid).get()])
  const legacyOwner = !membership.exists && business.data()?.ownerUid === auth.uid && business.data()?.memberUids?.includes(auth.uid)
  if (!business.exists || (!legacyOwner && (membership.data()?.status !== 'active' || !roles.includes(membership.data()?.role)))) {
    throw new HttpsError('permission-denied', 'Operational reporting is not available for this account.')
  }
  return { businessRef, businessId, uid: auth.uid, role: legacyOwner ? 'owner' : membership.data()!.role, displayName: membership.data()?.displayName ?? profileData.fullName ?? 'Staff member' }
}

export function publicProduct(id: string, data: FirebaseFirestore.DocumentData) {
  return {
    id, name: String(data.name ?? ''), description: String(data.description ?? ''), sku: String(data.sku ?? ''),
    barcode: String(data.barcode ?? ''), category: String(data.category ?? ''), sellingPrice: Number(data.sellingPrice ?? 0),
    quantity: Number(data.quantity ?? 0), reorderLevel: Number(data.reorderLevel ?? 0), trackStock: data.trackStock === true,
    unit: String(data.unit ?? 'item'), status: data.status === 'archived' ? 'archived' : 'active', lastMovementId: data.lastMovementId ?? null,
    tracksExpiry: data.tracksExpiry === true, shelfLifeDays: Number.isInteger(data.shelfLifeDays) ? data.shelfLifeDays : null,
    expiryWarningDays: Number.isInteger(data.expiryWarningDays) ? data.expiryWarningDays : 7,
    expiryCriticalDays: Number.isInteger(data.expiryCriticalDays) ? data.expiryCriticalDays : 3,
    productClass: String(data.productClass ?? 'inventory_item'), menuItem: data.menuItem === true,
    recipeId: typeof data.recipeId === 'string' ? data.recipeId : null, isIngredient: data.isIngredient === true,
    createdBy: String(data.createdBy ?? '')
  }
}

export async function listOperationalProductsForRequest(_data: unknown, auth: AuthContext | undefined, db: Firestore = getFirestore()) {
  if (_data == null || typeof _data !== 'object' || Array.isArray(_data) || Object.keys(_data as object).length !== 0) throw new HttpsError('invalid-argument', 'This request does not accept input fields.')
  const caller = await requireOperational(auth, db, ['owner', 'manager', 'supervisor', 'cashier'])
  const products = await caller.businessRef.collection('products').orderBy('name').limit(500).get()
  const today = businessDateKey()
  const values = await Promise.all(products.docs.map(async (item) => {
    const value = publicProduct(item.id, item.data())
    if (!value.tracksExpiry) return value
    const batches = await caller.businessRef.collection('inventoryBatches').where('productId', '==', item.id).where('status', '==', 'active').where('expiryDate', '>=', today).limit(200).get()
    return { ...value, quantity: batches.docs.reduce((sum, batch) => sum + Number(batch.data().quantityRemaining ?? 0), 0) }
  }))
  return { products: values }
}

export function publicSale(id: string, data: FirebaseFirestore.DocumentData) {
  return {
    id,
    items: Array.isArray(data.items) ? data.items.map((item: FirebaseFirestore.DocumentData) => ({
      productId: String(item.productId ?? ''), productName: String(item.productName ?? ''), sku: String(item.sku ?? ''),
      quantity: Number(item.quantity ?? 0), unitPrice: Number(item.unitPrice ?? 0), lineTotal: Number(item.lineTotal ?? 0),
      modifiers: Array.isArray(item.modifiers) ? item.modifiers.map((modifier: FirebaseFirestore.DocumentData) => ({ id: String(modifier.id ?? ''), label: String(modifier.label ?? ''), priceDelta: Number(modifier.priceDelta ?? 0) })) : [],
      preparationNotes: String(item.preparationNotes ?? ''), menuItem: item.menuItem === true,
      recipeSnapshot: item.recipeSnapshot && typeof item.recipeSnapshot === 'object' ? item.recipeSnapshot : null
    })) : [],
    itemCount: Number(data.itemCount ?? 0), subtotal: Number(data.subtotal ?? 0), discount: Number(data.discount ?? 0),
    total: Number(data.total ?? 0), paymentMethod: String(data.paymentMethod ?? 'other'), notes: String(data.notes ?? ''),
    customerId: data.customerId == null ? null : String(data.customerId),
    customerNameSnapshot: data.customerNameSnapshot == null ? null : String(data.customerNameSnapshot),
    cashierNameSnapshot: data.cashierNameSnapshot == null ? null : String(data.cashierNameSnapshot),
    cashierRoleSnapshot: data.cashierRoleSnapshot == null ? null : String(data.cashierRoleSnapshot),
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : null,
    createdBy: String(data.createdBy ?? '')
  }
}

export async function listOperationalSalesForRequest(_data: unknown, auth: AuthContext | undefined, db: Firestore = getFirestore()) {
  if (_data == null || typeof _data !== 'object' || Array.isArray(_data) || Object.keys(_data as object).length !== 0) throw new HttpsError('invalid-argument', 'This request does not accept input fields.')
  const caller = await requireOperational(auth, db, ['owner', 'manager', 'supervisor', 'cashier'])
  const sales = await caller.businessRef.collection('sales').orderBy('createdAt', 'desc').limit(500).get()
  return { sales: sales.docs.map((item) => publicSale(item.id, item.data())) }
}

function reportRange(data: unknown) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data as object).some((key) => !['from', 'to'].includes(key))) throw new HttpsError('invalid-argument', 'Choose a valid report range.')
  const input = data as { from?: unknown; to?: unknown }
  const from = Number(input?.from)
  const to = Number(input?.to)
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to || to - from > 93 * 86400000) throw new HttpsError('invalid-argument', 'Choose a valid report range of at most 93 days.')
  return { start: Timestamp.fromMillis(from), end: Timestamp.fromMillis(to) }
}

export async function getOperationalReportForRequest(data: unknown, auth: AuthContext | undefined, db: Firestore = getFirestore()) {
  const caller = await requireOperational(auth, db)
  const range = reportRange(data)
  const [sales, movements, products, customers] = await Promise.all([
    caller.businessRef.collection('sales').where('createdAt', '>=', range.start).where('createdAt', '<', range.end).orderBy('createdAt').limit(3000).get(),
    caller.businessRef.collection('inventoryMovements').where('createdAt', '>=', range.start).where('createdAt', '<', range.end).orderBy('createdAt', 'desc').limit(3000).get(),
    caller.businessRef.collection('products').orderBy('name').limit(500).get(),
    caller.businessRef.collection('customers').where('status', '==', 'active').count().get()
  ])
  const daily = new Map<string, { salesTotal: number; transactions: number }>()
  let salesTotal = 0
  let unitsSold = 0
  for (const item of sales.docs) {
    const sale = item.data()
    salesTotal += Number(sale.total ?? 0)
    unitsSold += Number(sale.itemCount ?? 0)
    const createdAt = sale.createdAt instanceof Timestamp ? sale.createdAt.toDate().toISOString().slice(0, 10) : 'unknown'
    const current = daily.get(createdAt) ?? { salesTotal: 0, transactions: 0 }
    current.salesTotal += Number(sale.total ?? 0); current.transactions++
    daily.set(createdAt, current)
  }
  const movementByProduct = new Map<string, { productName: string; movementCount: number; netQuantityChange: number }>()
  const recentAdjustments: Array<Record<string, unknown>> = []
  for (const item of movements.docs) {
    const movement = item.data()
    const key = String(movement.productId ?? item.id)
    const current = movementByProduct.get(key) ?? { productName: String(movement.productName ?? 'Product'), movementCount: 0, netQuantityChange: 0 }
    current.movementCount++; current.netQuantityChange += Number(movement.quantityChange ?? 0); movementByProduct.set(key, current)
    if (!['sale', 'recipe_consumption'].includes(String(movement.type)) && recentAdjustments.length < 20) recentAdjustments.push({ id: item.id, productName: current.productName, type: movement.type, quantityChange: movement.quantityChange, reason: movement.reason, createdAt: movement.createdAt instanceof Timestamp ? movement.createdAt.toMillis() : null })
  }
  const lowStock = products.docs.map((item) => publicProduct(item.id, item.data())).filter((product) => product.trackStock && product.status === 'active' && product.quantity <= product.reorderLevel)
  return {
    salesTotal: Math.round(salesTotal * 100) / 100, transactionCount: sales.size, unitsSold,
    salesTrend: [...daily.entries()].map(([date, value]) => ({ date, salesTotal: Math.round(value.salesTotal * 100) / 100, transactions: value.transactions })),
    productMovement: [...movementByProduct.entries()].map(([productId, value]) => ({ productId, ...value })).sort((a, b) => b.movementCount - a.movementCount).slice(0, 20),
    lowStock, recentAdjustments,
    activeCustomerCount: customers.data().count,
    recentSales: sales.docs.slice(-5).reverse().map((item) => publicSale(item.id, item.data()))
  }
}

export async function adjustOperationalInventoryForRequest(data: unknown, auth: AuthContext | undefined, db: Firestore = getFirestore()) {
  const caller = await requireOperational(auth, db)
  const input = data as Record<string, unknown>
  const productId = typeof input?.productId === 'string' ? input.productId.trim() : ''
  const type = input?.type
  const quantity = Number(input?.quantity)
  const reason = typeof input?.reason === 'string' ? input.reason.trim() : ''
  if (Object.keys(input ?? {}).some((key) => !['productId', 'type', 'quantity', 'reason'].includes(key))
    || !productId || productId.length > 150
    || !['stock_in', 'stock_out', 'adjustment', 'return', 'damaged', 'expired'].includes(String(type))
    || !Number.isFinite(quantity) || quantity === 0 || Math.abs(quantity) > 1000000
    || !reason || reason.length > 300) throw new HttpsError('invalid-argument', 'Enter a valid stock adjustment.')
  const productRef = caller.businessRef.collection('products').doc(productId)
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(productRef)
    if (!snapshot.exists) throw new HttpsError('not-found', 'Product was not found.')
    const product = snapshot.data()!
    const before = Number(product.quantity ?? 0)
    const signed = type === 'stock_in' || type === 'return' ? Math.abs(quantity) : type === 'adjustment' ? quantity : -Math.abs(quantity)
    const after = before + signed
    if (after < 0) throw new HttpsError('failed-precondition', 'Stock cannot become negative.')
    const movementRef = caller.businessRef.collection('inventoryMovements').doc()
    const now = Timestamp.now()
    transaction.update(productRef, { quantity: after, lastMovementId: movementRef.id, updatedAt: now })
    transaction.create(movementRef, { productId, productName: product.name, type, quantityChange: signed, quantityBefore: before, quantityAfter: after, reason, referenceId: null, createdAt: now, createdBy: caller.uid })
    transaction.create(caller.businessRef.collection('staffActivity').doc(), auditData('stock_adjusted', caller.uid, caller.uid, { actorName: caller.displayName, targetName: String(product.name ?? 'Product'), previousValue: before, newValue: after, description: `${caller.displayName} adjusted ${product.name ?? 'product'} stock from ${before} to ${after}.` }, now))
    return { quantityAfter: after }
  })
}
