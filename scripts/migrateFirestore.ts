import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { FieldPath, Timestamp, getFirestore, type DocumentReference } from 'firebase-admin/firestore'

const MIGRATION_VERSION = 3
const args = new Set(process.argv.slice(2))
const execute = args.has('--execute')
const dryRun = !execute
const projectArgIndex = process.argv.indexOf('--project')
const projectId = projectArgIndex >= 0 ? process.argv[projectArgIndex + 1] : process.env.FIREBASE_PROJECT_ID

if (!projectId) throw new Error('Set FIREBASE_PROJECT_ID or pass --project <id>.')
if (execute && process.env.SMALLBIZZ_ALLOW_MIGRATION !== 'YES') {
  throw new Error('Execution requires both --execute and SMALLBIZZ_ALLOW_MIGRATION=YES.')
}

initializeApp({ credential: applicationDefault(), projectId })
const db = getFirestore()
const summary = { scanned: 0, proposed: 0, updated: 0, skipped: 0, malformed: 0, movements: 0, memberships: 0 }

function log(message: string, details?: unknown) {
  console.log(`[${dryRun ? 'DRY RUN' : 'EXECUTE'}] ${message}`, details ?? '')
}

function asTimestamp(value: unknown, fallback = Timestamp.now()) {
  if (value instanceof Timestamp) return value
  if (value instanceof Date && !Number.isNaN(value.getTime())) return Timestamp.fromDate(value)
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) return Timestamp.fromDate(date)
  }
  return fallback
}

function money(value: unknown, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.round(number * 100) / 100 : fallback
}

function stock(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0
}

function normalizedPayment(value: unknown) {
  const payment = String(value ?? '').toLowerCase().replace(/[ -]/g, '_')
  if (payment === 'bank_transfer' || payment === 'transfer') return 'eft'
  if (payment === 'credit_card' || payment === 'debit_card') return 'card'
  return ['cash', 'card', 'eft', 'mobile', 'other'].includes(payment) ? payment : 'other'
}

async function propose(ref: DocumentReference, changes: Record<string, unknown>, label: string) {
  if (Object.keys(changes).length === 0) { summary.skipped++; return }
  summary.proposed++
  log(`${label}: ${ref.path}`, changes)
  if (!dryRun) { await ref.set(changes, { merge: true }); summary.updated++ }
}

async function migrateProducts(businessRef: DocumentReference, ownerUid: string) {
  const snapshot = await businessRef.collection('products').orderBy(FieldPath.documentId()).get()
  for (const productDoc of snapshot.docs) {
    summary.scanned++
    const data = productDoc.data()
    if (data.migrationVersion === MIGRATION_VERSION) { summary.skipped++; continue }
    const name = String(data.name ?? '').trim()
    if (!name) { summary.malformed++; log(`MALFORMED product without name: ${productDoc.ref.path}`); continue }
    const quantity = stock(data.quantity)
    const createdAt = asTimestamp(data.createdAt ?? data.dateCreated)
    const changes: Record<string, unknown> = {
      description: String(data.description ?? ''), sku: String(data.sku ?? data.SKU ?? ''),
      barcode: String(data.barcode ?? ''), category: String(data.category ?? ''),
      sellingPrice: money(data.sellingPrice ?? data.price), costPrice: money(data.costPrice ?? data.cost),
      quantity, reorderLevel: stock(data.reorderLevel ?? data.minimumStock),
      trackStock: typeof data.trackStock === 'boolean' ? data.trackStock : true,
      unit: String(data.unit ?? 'item'), status: data.status === 'archived' ? 'archived' : 'active',
      createdBy: String(data.createdBy ?? ownerUid), createdAt,
      updatedAt: asTimestamp(data.updatedAt, createdAt), migrationVersion: MIGRATION_VERSION
    }

    if (quantity > 0 && !data.lastMovementId) {
      const movementRef = businessRef.collection('inventoryMovements').doc(`migration-opening-${productDoc.id}`)
      const existing = await movementRef.get()
      changes.lastMovementId = movementRef.id
      if (!existing.exists) {
        const movement = {
          productId: productDoc.id, productName: name, type: 'opening_stock',
          quantityChange: quantity, quantityBefore: 0, quantityAfter: quantity,
          reason: 'Legacy opening balance migration', referenceId: null,
          createdAt, createdBy: String(data.createdBy ?? ownerUid), migrationVersion: MIGRATION_VERSION
        }
        log(`opening movement: ${movementRef.path}`, movement)
        if (!dryRun) await movementRef.create(movement)
        summary.movements++
      }
    } else if (!('lastMovementId' in data)) changes.lastMovementId = null
    await propose(productDoc.ref, changes, 'product')
  }
}

async function migrateSales(businessRef: DocumentReference, ownerUid: string) {
  const snapshot = await businessRef.collection('sales').get()
  for (const saleDoc of snapshot.docs) {
    summary.scanned++
    const data = saleDoc.data()
    if (data.migrationVersion === MIGRATION_VERSION) { summary.skipped++; continue }
    const rawItems = Array.isArray(data.items) ? data.items : []
    const items = rawItems.map((item: Record<string, unknown>) => ({
      productId: String(item.productId ?? item.id ?? ''),
      productName: String(item.productName ?? item.name ?? 'Legacy item'),
      sku: String(item.sku ?? item.SKU ?? ''), quantity: Math.max(1, stock(item.quantity)),
      unitPrice: money(item.unitPrice ?? item.price), costPrice: money(item.costPrice ?? item.cost),
      lineTotal: money(item.lineTotal, money(item.unitPrice ?? item.price) * Math.max(1, stock(item.quantity)))
    }))
    if (items.length === 0) { summary.malformed++; log(`MALFORMED sale without recoverable items: ${saleDoc.ref.path}`); continue }
    const subtotal = money(data.subtotal, items.reduce((sum, item) => sum + item.lineTotal, 0))
    const discount = money(data.discount)
    const total = money(data.total, Math.max(0, subtotal - discount))
    await propose(saleDoc.ref, {
      items, itemCount: stock(data.itemCount) || items.reduce((sum, item) => sum + item.quantity, 0),
      subtotal, discount, total, grossProfit: Number.isFinite(Number(data.grossProfit)) ? Number(data.grossProfit) : 0,
      paymentMethod: normalizedPayment(data.paymentMethod), notes: String(data.notes ?? ''),
      customerId: data.customerId ?? null, customerNameSnapshot: data.customerNameSnapshot ?? null,
      createdAt: asTimestamp(data.createdAt ?? data.date), createdBy: String(data.createdBy ?? ownerUid),
      migrationVersion: MIGRATION_VERSION
    }, 'sale')
  }
}

async function migrateOwnerMembership(businessRef: DocumentReference, ownerUid: string, businessData: Record<string, unknown>) {
  const memberRef = businessRef.collection('members').doc(ownerUid)
  const existing = await memberRef.get()
  summary.scanned++
  if (existing.exists) {
    const data = existing.data()!
    if (data.role !== 'owner' || data.uid !== ownerUid) {
      summary.malformed++
      log(`REVIEW conflicting owner membership: ${memberRef.path}`, { role: data.role, uid: data.uid })
    } else summary.skipped++
    return
  }

  const ownerProfile = await db.doc(`users/${ownerUid}`).get()
  const profile = ownerProfile.data() ?? {}
  const createdAt = asTimestamp(businessData.createdAt)
  await propose(memberRef, {
    uid: ownerUid,
    displayName: String(profile.fullName ?? profile.displayName ?? profile.email ?? 'Business owner'),
    email: String(profile.email ?? ''),
    role: 'owner',
    status: 'active',
    invitedBy: null,
    createdAt,
    updatedAt: asTimestamp(businessData.updatedAt, createdAt),
    joinedAt: createdAt,
    lastActiveAt: null
  }, 'owner membership')
  summary.memberships++
}

async function migrateBusinesses() {
  const businesses = await db.collection('businesses').get()
  for (const businessDoc of businesses.docs) {
    summary.scanned++
    const data = businessDoc.data()
    const ownerUid = String(data.ownerUid ?? data.ownerId ?? '')
    if (!ownerUid) { summary.malformed++; log(`MALFORMED business without owner: ${businessDoc.ref.path}`); continue }
    const legacyMembers = Array.isArray(data.memberUids)
      ? data.memberUids
      : Array.isArray(data.members)
        ? data.members
        : data.members && typeof data.members === 'object'
          ? Object.keys(data.members)
          : [ownerUid]
    if (data.migrationVersion === MIGRATION_VERSION) summary.skipped++
    else await propose(businessDoc.ref, {
        ownerUid, memberUids: [...new Set([ownerUid, ...legacyMembers.map(String)])],
        accountStatus: data.accountStatus ?? 'SUSPENDED', planId: data.planId ?? 'legacy_review',
        createdAt: asTimestamp(data.createdAt), updatedAt: asTimestamp(data.updatedAt ?? data.createdAt),
        migrationVersion: MIGRATION_VERSION
      }, 'business')
    await migrateOwnerMembership(businessDoc.ref, ownerUid, data)
    await migrateProducts(businessDoc.ref, ownerUid)
    await migrateSales(businessDoc.ref, ownerUid)
  }
}

async function migrateUsers() {
  const users = await db.collection('users').get()
  for (const userDoc of users.docs) {
    summary.scanned++
    const data = userDoc.data()
    const legacyBusinessIds = Array.isArray(data.businesses) ? data.businesses.map(String) : []
    const businessId = data.businessId ?? legacyBusinessIds[0] ?? null
    if (!businessId) log(`REVIEW user without linked business: ${userDoc.ref.path}`)
    if (data.migrationVersion === MIGRATION_VERSION) {
      await propose(userDoc.ref, businessId && !data.linkedBusinessId ? { linkedBusinessId: businessId } : {}, 'user link')
    } else {
      await propose(userDoc.ref, {
        fullName: String(data.fullName ?? data.name ?? ''), email: data.email ?? null,
        role: 'USER', accountStatus: data.accountStatus ?? 'SUSPENDED', businessId,
        linkedBusinessId: businessId,
        onboardingComplete: Boolean(businessId), termsVersion: data.termsVersion ?? null,
        termsAcceptedAt: data.termsAcceptedAt ?? null, createdAt: asTimestamp(data.createdAt),
        updatedAt: asTimestamp(data.updatedAt ?? data.createdAt), migrationVersion: MIGRATION_VERSION
      }, 'user')
    }
  }
}

log(`Project ${projectId}. Legacy fields are preserved; no deletes are performed.`)
await migrateBusinesses()
await migrateUsers()
console.log('Migration summary:', { mode: dryRun ? 'dry-run' : 'execute', ...summary })
