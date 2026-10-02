import { readFileSync } from 'node:fs'
import { after, before, beforeEach, describe, test } from 'node:test'
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getCountFromServer, getDoc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from 'firebase/firestore'

const projectId = 'demo-smallbizz'
const firestoreEmulator = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080'
const emulatorSeparator = firestoreEmulator.lastIndexOf(':')
const firestoreHost = firestoreEmulator.slice(0, emulatorSeparator)
const firestorePort = Number(firestoreEmulator.slice(emulatorSeparator + 1))
let environment: RulesTestEnvironment

const business = (ownerUid: string, memberUids: string[], accountStatus = 'TRIAL') => ({
  name: `${ownerUid} business`, type: 'Retail', ownerUid, memberUids, accountStatus,
  planId: 'trial', onboardingComplete: true
})
const user = (businessId: string, accountStatus = 'ACTIVE') => ({
  fullName: 'Test User', email: 'test@example.com', role: 'USER', accountStatus,
  businessId, linkedBusinessId: businessId, onboardingComplete: true
})
const member = (uid: string, role: 'owner' | 'manager' | 'supervisor' | 'cashier', status: 'invited' | 'active' | 'suspended' | 'disabled' = 'active') => ({
  uid, displayName: uid, email: `${uid}@example.com`, role, status, invitedBy: role === 'owner' ? null : 'alice',
  createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), joinedAt: status === 'invited' ? null : new Date('2026-01-01'), lastActiveAt: null
})
const product = (createdBy: string, quantity = 0) => ({
  name: 'Coffee', description: '', sku: 'COF', barcode: '', category: 'Drinks',
  sellingPrice: 20, costPrice: 8, quantity, reorderLevel: 2, trackStock: true,
  unit: 'item', status: 'active', lastMovementId: null,
  createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01'), createdBy
})
const validSale = (createdBy: string) => ({
  items: [{ productId: 'product-a', productName: 'Coffee', sku: 'COF', quantity: 1, unitPrice: 20, costPrice: 8, lineTotal: 20 }],
  itemCount: 1, subtotal: 20, discount: 0, total: 20, grossProfit: 12,
  paymentMethod: 'cash', notes: '', customerId: null, customerNameSnapshot: null,
  createdAt: serverTimestamp(), createdBy
})

before(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: firestoreHost, port: firestorePort }
  })
})

beforeEach(async () => {
  await environment.clearFirestore()
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore()
    await Promise.all([
      setDoc(doc(db, 'users/alice'), user('business-a')),
      setDoc(doc(db, 'users/bob'), user('business-b')),
      setDoc(doc(db, 'users/manager'), user('business-a')),
      setDoc(doc(db, 'users/supervisor'), user('business-a')),
      setDoc(doc(db, 'users/cashier'), user('business-a')),
      setDoc(doc(db, 'users/suspended'), user('business-a')),
      setDoc(doc(db, 'users/disabled'), user('business-a')),
      setDoc(doc(db, 'businesses/business-a'), business('alice', ['alice', 'manager', 'supervisor', 'cashier', 'suspended', 'disabled'])),
      setDoc(doc(db, 'businesses/business-b'), business('bob', ['bob'])),
      setDoc(doc(db, 'businesses/business-a/members/alice'), member('alice', 'owner')),
      setDoc(doc(db, 'businesses/business-a/members/manager'), member('manager', 'manager')),
      setDoc(doc(db, 'businesses/business-a/members/supervisor'), member('supervisor', 'supervisor')),
      setDoc(doc(db, 'businesses/business-a/members/cashier'), member('cashier', 'cashier')),
      setDoc(doc(db, 'businesses/business-a/members/suspended'), member('suspended', 'cashier', 'suspended')),
      setDoc(doc(db, 'businesses/business-a/members/disabled'), member('disabled', 'cashier', 'disabled')),
      setDoc(doc(db, 'businesses/business-b/members/bob'), member('bob', 'owner')),
      setDoc(doc(db, 'businesses/business-a/products/product-a'), product('alice', 10)),
      setDoc(doc(db, 'businesses/business-b/products/product-b'), product('bob', 5))
    ])
  })
})

after(async () => environment.cleanup())

describe('tenant and account security', () => {
  test('new owner onboarding atomically creates the authoritative owner membership', async () => {
    const db = environment.authenticatedContext('new-owner').firestore()
    const userRef = doc(db, 'users/new-owner')
    await assertSucceeds(setDoc(userRef, {
      fullName: 'New Owner', email: 'owner@example.com', role: 'USER', accountStatus: 'ACTIVE',
      businessId: null, linkedBusinessId: null, onboardingComplete: false,
      termsVersion: null, termsAcceptedAt: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    }))
    const batch = writeBatch(db)
    batch.update(userRef, {
      businessId: 'new-business', linkedBusinessId: 'new-business', onboardingComplete: true,
      termsVersion: '2026-09-07', termsAcceptedAt: serverTimestamp(), updatedAt: serverTimestamp()
    })
    batch.set(doc(db, 'businesses/new-business'), {
      name: 'New Business', type: 'Retail', ownerUid: 'new-owner', memberUids: ['new-owner'],
      accountStatus: 'TRIAL', planId: 'trial', trialStartedAt: serverTimestamp(),
      trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), currency: 'ZAR', phone: '',
      email: 'owner@example.com', address: '', website: '', registrationNumber: '',
      vatRegistered: false, vatNumber: null, invoicePrefix: 'INV', onboardingComplete: true,
      termsVersion: '2026-09-07', termsAcceptedAt: serverTimestamp(), createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    })
    batch.set(doc(db, 'businesses/new-business/members/new-owner'), {
      uid: 'new-owner', displayName: 'New Owner', email: 'owner@example.com', role: 'owner', status: 'active',
      invitedBy: null, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      joinedAt: serverTimestamp(), lastActiveAt: serverTimestamp()
    })
    await assertSucceeds(batch.commit())
  })

  test('a member reads its business and commerce collections but not another tenant', async () => {
    const alice = environment.authenticatedContext('alice').firestore()
    await assertSucceeds(getDoc(doc(alice, 'businesses/business-a')))
    await assertSucceeds(getDoc(doc(alice, 'businesses/business-a/products/product-a')))
    await assertSucceeds(getDoc(doc(alice, 'businesses/business-a/inventoryMovements/missing')))
    await assertSucceeds(getDoc(doc(alice, 'businesses/business-a/sales/missing')))
    await assertFails(getDoc(doc(alice, 'businesses/business-b')))
    await assertFails(setDoc(doc(alice, 'businesses/business-b/products/hijack'), { ...product('alice'), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }))
  })

  test('unauthenticated and suspended users cannot access tenant data', async () => {
    await assertFails(getDoc(doc(environment.unauthenticatedContext().firestore(), 'businesses/business-a')))
    await assertFails(getDoc(doc(environment.authenticatedContext('suspended').firestore(), 'businesses/business-a')))
    await assertFails(getDoc(doc(environment.authenticatedContext('disabled').firestore(), 'businesses/business-a/products/product-a')))
    await assertSucceeds(getDoc(doc(environment.authenticatedContext('suspended').firestore(), 'businesses/business-a/members/suspended')))
  })
})

describe('products and inventory audit', () => {
  test('allows valid product creation and rejects invalid or reassigned documents', async () => {
    const db = environment.authenticatedContext('alice').firestore()
    await assertSucceeds(setDoc(doc(db, 'businesses/business-a/products/new'), { ...product('alice'), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }))
    await assertFails(setDoc(doc(db, 'businesses/business-a/products/negative'), { ...product('alice'), quantity: -1, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }))
    await assertFails(setDoc(doc(db, 'businesses/business-a/products/reassigned'), { ...product('alice'), businessId: 'business-b', createdAt: serverTimestamp(), updatedAt: serverTimestamp() }))
  })

  test('protects audit fields and requires a matching movement for stock changes', async () => {
    const db = environment.authenticatedContext('alice').firestore()
    const ref = doc(db, 'businesses/business-a/products/product-a')
    await assertFails(updateDoc(ref, { createdBy: 'bob', updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(ref, { quantity: 9, updatedAt: serverTimestamp() }))
    await assertFails(deleteDoc(ref))
  })

  test('allows an atomic valid movement and makes it immutable', async () => {
    const db = environment.authenticatedContext('alice').firestore()
    const productRef = doc(db, 'businesses/business-a/products/product-a')
    const movementRef = doc(db, 'businesses/business-a/inventoryMovements/movement-a')
    const batch = writeBatch(db)
    batch.update(productRef, { quantity: 8, lastMovementId: 'movement-a', updatedAt: serverTimestamp() })
    batch.set(movementRef, { productId: 'product-a', productName: 'Coffee', type: 'stock_out', quantityChange: -2, quantityBefore: 10, quantityAfter: 8, reason: 'Count correction', referenceId: null, createdAt: serverTimestamp(), createdBy: 'alice' })
    await assertSucceeds(batch.commit())
    await assertFails(updateDoc(movementRef, { reason: 'Rewritten' }))
    await assertFails(deleteDoc(movementRef))
  })

  test('rejects invalid balances and cross-business movements', async () => {
    const db = environment.authenticatedContext('alice').firestore()
    await assertFails(setDoc(doc(db, 'businesses/business-a/inventoryMovements/bad'), { productId: 'product-a', productName: 'Coffee', type: 'stock_out', quantityChange: -2, quantityBefore: 10, quantityAfter: 9, reason: 'Invalid', referenceId: null, createdAt: serverTimestamp(), createdBy: 'alice' }))
    await assertFails(setDoc(doc(db, 'businesses/business-b/inventoryMovements/cross'), { productId: 'product-b', productName: 'Coffee', type: 'stock_in', quantityChange: 1, quantityBefore: 5, quantityAfter: 6, reason: 'Cross tenant', referenceId: null, createdAt: serverTimestamp(), createdBy: 'alice' }))
  })
})

describe('sales', () => {
  test('requires trusted function creation and keeps stored sales immutable', async () => {
    const db = environment.authenticatedContext('alice').firestore()
    const ref = doc(db, 'businesses/business-a/sales/sale-a')
    await assertFails(setDoc(ref, validSale('alice')))
    await environment.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), ref.path), { ...validSale('alice'), createdAt: new Date(), cashierNameSnapshot: 'Alice', cashierRoleSnapshot: 'owner' }))
    await assertSucceeds(getDoc(ref))
    await assertFails(updateDoc(ref, { notes: 'changed' }))
    await assertFails(deleteDoc(ref))
  })

  test('rejects invalid totals, payment method, and cross-tenant sales', async () => {
    const db = environment.authenticatedContext('alice').firestore()
    await assertFails(setDoc(doc(db, 'businesses/business-a/sales/bad-total'), { ...validSale('alice'), total: 19 }))
    await assertFails(setDoc(doc(db, 'businesses/business-a/sales/bad-payment'), { ...validSale('alice'), paymentMethod: 'crypto' }))
    await assertFails(setDoc(doc(db, 'businesses/business-b/sales/cross'), validSale('alice')))
  })
})

describe('staff memberships and role permissions', () => {
  test('owner can view staff while all authoritative membership writes require Admin SDK', async () => {
    const owner = environment.authenticatedContext('alice').firestore()
    await assertSucceeds(getDocs(collection(owner, 'businesses/business-a/members')))
    await assertFails(updateDoc(doc(owner, 'businesses/business-a/members/cashier'), { role: 'manager', updatedAt: serverTimestamp() }))
    await assertFails(updateDoc(doc(owner, 'businesses/business-a/members/alice'), { role: 'cashier', updatedAt: serverTimestamp() }))
  })

  test('manager, supervisor, and cashier cannot modify staff or assign owner', async () => {
    for (const uid of ['manager', 'supervisor', 'cashier']) {
      const db = environment.authenticatedContext(uid).firestore()
      await assertFails(updateDoc(doc(db, 'businesses/business-a/members/cashier'), { role: 'owner', updatedAt: serverTimestamp() }))
      await assertFails(setDoc(doc(db, 'businesses/business-a/members/injected'), member('injected', 'owner')))
    }
  })

  test('staff can read only their own membership and cross-tenant staff access is denied', async () => {
    const manager = environment.authenticatedContext('manager').firestore()
    await assertSucceeds(getDoc(doc(manager, 'businesses/business-a/members/manager')))
    await assertFails(getDoc(doc(manager, 'businesses/business-a/members/cashier')))
    await assertFails(getDoc(doc(manager, 'businesses/business-b/members/bob')))
  })

  test('cashier uses server projections for products and sales and cannot access financial documents', async () => {
    const db = environment.authenticatedContext('cashier').firestore()
    await assertFails(getDoc(doc(db, 'businesses/business-a/products/product-a')))
    await assertFails(getDoc(doc(db, 'businesses/business-a/sales/missing')))
    await assertSucceeds(getDoc(doc(db, 'businesses/business-a/customers/missing')))
    await assertFails(setDoc(doc(db, 'businesses/business-a/products/new'), { ...product('cashier'), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }))
    await assertFails(setDoc(doc(db, 'businesses/business-a/customers/new'), { firstName: 'C', lastName: '', displayName: 'C', phone: '', email: '', birthday: null, notes: '', status: 'active', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: 'cashier' }))
    await assertFails(getDoc(doc(db, 'businesses/business-a/expenses/missing')))
    await assertFails(getDoc(doc(db, 'businesses/business-a/suppliers/missing')))
  })

  test('supervisor uses trusted operational callables while manager retains financial access', async () => {
    const supervisorDb = environment.authenticatedContext('supervisor').firestore()
    await assertFails(getDoc(doc(supervisorDb, 'businesses/business-a/products/product-a')))
    await assertFails(setDoc(doc(supervisorDb, 'businesses/business-a/products/supervisor-product'), { ...product('supervisor'), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }))
    await assertFails(getDoc(doc(supervisorDb, 'businesses/business-a/sales/missing')))
    await assertFails(getDoc(doc(supervisorDb, 'businesses/business-a/members/cashier')))
    await assertFails(getDoc(doc(supervisorDb, 'businesses/business-a/expenses/missing')))
    const managerDb = environment.authenticatedContext('manager').firestore()
    await assertSucceeds(setDoc(doc(managerDb, 'businesses/business-a/expenses/manager-expense'), { description: 'Rent', category: 'rent', amount: 100, expenseDate: new Date(), paymentMethod: 'eft', supplierId: null, supplierNameSnapshot: null, reference: '', notes: '', status: 'active', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: 'manager' }))
  })

  test('only owners can read invitation and immutable activity records', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await setDoc(doc(db, 'businesses/business-a/staffInvitations/invite-a'), { invitedEmail: 'new@example.com', status: 'sent', createdAt: new Date() })
      await setDoc(doc(db, 'businesses/business-a/staffActivity/event-a'), { type: 'invitation_sent', createdAt: new Date() })
    })
    const owner = environment.authenticatedContext('alice').firestore()
    const manager = environment.authenticatedContext('manager').firestore()
    await assertSucceeds(getDoc(doc(owner, 'businesses/business-a/staffInvitations/invite-a')))
    await assertSucceeds(getDoc(doc(owner, 'businesses/business-a/staffActivity/event-a')))
    await assertFails(getDoc(doc(manager, 'businesses/business-a/staffInvitations/invite-a')))
    await assertFails(getDoc(doc(manager, 'businesses/business-a/staffActivity/event-a')))
    await assertFails(setDoc(doc(owner, 'businesses/business-a/staffActivity/forged'), { type: 'forged', createdAt: serverTimestamp() }))
    await assertFails(updateDoc(doc(owner, 'businesses/business-a/staffInvitations/invite-a'), { status: 'accepted' }))
    await assertFails(getDoc(doc(owner, 'businesses/business-a/staffInvitationLocks/secret-hash')))
    await assertFails(setDoc(doc(owner, 'businesses/business-a/staffInvitationLocks/secret-hash'), { status: 'accepted' }))
  })
})

describe('expenses, customers, and suppliers', () => {
  test('allows valid tenant records and denies cross-tenant writes', async () => {
    const db = environment.authenticatedContext('alice').firestore()
    await assertSucceeds(setDoc(doc(db, 'businesses/business-a/customers/customer-a'), { firstName: 'Ada', lastName: '', displayName: 'Ada', phone: '', email: '', birthday: null, notes: '', status: 'active', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: 'alice' }))
    await assertSucceeds(setDoc(doc(db, 'businesses/business-a/suppliers/supplier-a'), { name: 'Acme', contactPerson: '', phone: '', email: '', address: '', notes: '', status: 'active', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: 'alice' }))
    await assertSucceeds(setDoc(doc(db, 'businesses/business-a/expenses/expense-a'), { description: 'Rent', category: 'rent', amount: 1000, expenseDate: new Date(), paymentMethod: 'eft', supplierId: null, supplierNameSnapshot: null, reference: '', notes: '', status: 'active', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: 'alice' }))
    await assertFails(setDoc(doc(db, 'businesses/business-b/customers/cross'), { firstName: 'Bad', lastName: '', displayName: 'Bad', phone: '', email: '', birthday: null, notes: '', status: 'active', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), createdBy: 'alice' }))
  })

  test('protects ownership fields and denies destructive deletion', async () => {
    const db = environment.authenticatedContext('alice').firestore()
    const ref = doc(db, 'businesses/business-a/customers/customer-a')
    await environment.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), ref.path), { firstName: 'Ada', lastName: '', displayName: 'Ada', phone: '', email: '', birthday: null, notes: '', status: 'active', createdAt: new Date(), updatedAt: new Date(), createdBy: 'alice' }))
    await assertFails(updateDoc(ref, { createdBy: 'bob', updatedAt: serverTimestamp() }))
    await assertFails(deleteDoc(ref))
  })
})

describe('restaurant collections', () => {
  test('recipe reads are tenant scoped while every browser recipe mutation is denied', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'businesses/business-a/recipes/kota'), { productId: 'kota', nameSnapshot: 'Kota', version: 1, active: true, ingredients: [], modifierGroups: [] })
      await setDoc(doc(context.firestore(), 'businesses/business-a/recipeVersions/kota_v1'), { recipeId: 'kota', version: 1, immutable: true })
    })
    for (const uid of ['alice', 'manager', 'supervisor']) await assertSucceeds(getDoc(doc(environment.authenticatedContext(uid).firestore(), 'businesses/business-a/recipes/kota')))
    for (const uid of ['alice', 'manager', 'supervisor']) await assertSucceeds(getDoc(doc(environment.authenticatedContext(uid).firestore(), 'businesses/business-a/recipeVersions/kota_v1')))
    await assertFails(getDoc(doc(environment.authenticatedContext('cashier').firestore(), 'businesses/business-a/recipes/kota')))
    await assertFails(getDoc(doc(environment.authenticatedContext('cashier').firestore(), 'businesses/business-a/recipeVersions/kota_v1')))
    await assertFails(getDoc(doc(environment.authenticatedContext('alice').firestore(), 'businesses/business-b/recipes/kota')))
    await assertFails(setDoc(doc(environment.authenticatedContext('alice').firestore(), 'businesses/business-a/recipes/forged'), { productId: 'forged' }))
    await assertFails(updateDoc(doc(environment.authenticatedContext('manager').firestore(), 'businesses/business-a/recipes/kota'), { version: 99 }))
    await assertFails(updateDoc(doc(environment.authenticatedContext('alice').firestore(), 'businesses/business-a/recipeVersions/kota_v1'), { version: 99 }))
  })

  test('kitchen tickets are visible to staff but status and audit writes require trusted functions', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await setDoc(doc(db, 'businesses/business-a/kitchenOrders/order-a'), { status: 'new', createdAt: new Date() })
      await setDoc(doc(db, 'businesses/business-a/kitchenOrderActivity/audit-a'), { orderId: 'order-a', timestamp: new Date() })
    })
    for (const uid of ['alice', 'manager', 'supervisor', 'cashier']) await assertSucceeds(getDoc(doc(environment.authenticatedContext(uid).firestore(), 'businesses/business-a/kitchenOrders/order-a')))
    await assertFails(updateDoc(doc(environment.authenticatedContext('alice').firestore(), 'businesses/business-a/kitchenOrders/order-a'), { status: 'ready' }))
    await assertFails(updateDoc(doc(environment.authenticatedContext('cashier').firestore(), 'businesses/business-a/kitchenOrders/order-a'), { status: 'completed' }))
    await assertSucceeds(getDoc(doc(environment.authenticatedContext('supervisor').firestore(), 'businesses/business-a/kitchenOrderActivity/audit-a')))
    await assertFails(getDoc(doc(environment.authenticatedContext('cashier').firestore(), 'businesses/business-a/kitchenOrderActivity/audit-a')))
    await assertFails(setDoc(doc(environment.authenticatedContext('manager').firestore(), 'businesses/business-a/kitchenOrderActivity/forged'), { orderId: 'order-a' }))
  })
})

describe('trusted operational collections', () => {
  test('batches and promotions stay callable-only while owner settings remain constrained', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await setDoc(doc(db, 'businesses/business-a/inventoryBatches/batch-a'), { productId: 'product-a', status: 'active', quantityRemaining: 5 })
      await setDoc(doc(db, 'businesses/business-a/promotions/promo-a'), { name: 'Promo', status: 'active' })
      await setDoc(doc(db, 'businesses/business-a/settings/operations'), { discountLimits: { cashier: 0 } })
    })
    for (const uid of ['alice', 'manager', 'supervisor', 'cashier']) {
      const db = environment.authenticatedContext(uid).firestore()
      await assertFails(getDoc(doc(db, 'businesses/business-a/inventoryBatches/batch-a')))
      await assertFails(getDoc(doc(db, 'businesses/business-a/promotions/promo-a')))
      await assertFails(setDoc(doc(db, 'businesses/business-a/inventoryBatches/forged'), { productId: 'product-a', quantityRemaining: 999 }))
    }
    const owner = environment.authenticatedContext('alice').firestore()
    const manager = environment.authenticatedContext('manager').firestore()
    await assertSucceeds(getDoc(doc(owner, 'businesses/business-a/settings/operations')))
    await assertFails(getDoc(doc(manager, 'businesses/business-a/settings/operations')))
    await assertFails(getDoc(doc(owner, 'businesses/business-b/settings/operations')))
  })
})

describe('reporting queries', () => {
  test('allows bounded tenant report queries and denies cross-tenant or unauthenticated queries', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore()
      await setDoc(doc(db, 'businesses/business-a/sales/report-sale'), { ...validSale('alice'), customerId: 'customer-a', customerNameSnapshot: 'Ada', createdAt: new Date('2026-09-08T10:00:00Z') })
      await setDoc(doc(db, 'businesses/business-b/sales/report-sale'), { ...validSale('bob'), createdAt: new Date('2026-09-08T10:00:00Z'), createdBy: 'bob' })
    })
    const alice = environment.authenticatedContext('alice').firestore()
    const unauthenticated = environment.unauthenticatedContext().firestore()
    const start = new Date('2026-09-01T00:00:00Z')
    await assertSucceeds(getDocs(query(collection(alice, 'businesses/business-a/sales'), where('createdAt', '>=', start), orderBy('createdAt'), limit(50))))
    await assertSucceeds(getDocs(query(collection(alice, 'businesses/business-a/sales'), where('customerId', '==', 'customer-a'), orderBy('createdAt', 'desc'), limit(50))))
    await assertSucceeds(getCountFromServer(query(collection(alice, 'businesses/business-a/customers'), where('status', '==', 'active'))))
    await assertFails(getDocs(query(collection(alice, 'businesses/business-b/sales'), where('createdAt', '>=', start), orderBy('createdAt'), limit(50))))
    await assertFails(getDocs(query(collection(unauthenticated, 'businesses/business-a/sales'), where('createdAt', '>=', start), orderBy('createdAt'), limit(50))))
  })
})

describe('platform administration', () => {
  test('a normal client cannot grant itself admin or access platform documents', async () => {
    const db = environment.authenticatedContext('alice').firestore()
    await assertFails(updateDoc(doc(db, 'users/alice'), { platformAdmin: true, updatedAt: serverTimestamp() }))
    await assertFails(getDoc(doc(db, 'platform/settings')))
  })

  test('platformAdmin can read tenants and update intended account state but not business records', async () => {
    const db = environment.authenticatedContext('admin', { platformAdmin: true }).firestore()
    await assertSucceeds(getDoc(doc(db, 'businesses/business-a')))
    await assertSucceeds(updateDoc(doc(db, 'businesses/business-a'), { accountStatus: 'SUSPENDED', updatedAt: serverTimestamp() }))
    await assertFails(setDoc(doc(db, 'businesses/business-a/products/admin-product'), { ...product('admin'), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }))
  })
})
