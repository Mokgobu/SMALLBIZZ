import { expect, test } from '@playwright/test'
import { Timestamp } from 'firebase-admin/firestore'
import { adminDb, callFunction, expectFunctionRejected, login, resetEmulators, seedBusiness, seedUser, signInToken, PROJECT_ID } from './support/emulator'

const sale = (productId: string, quantity = 1, extras: Record<string, unknown> = {}) => ({
  items: [{ productId, quantity, modifierOptionIds: [], preparationNotes: '', ...extras }],
  customerId: null,
  discount: 0,
  promotionId: null,
  paymentMethod: 'cash',
  notes: ''
})

const product = (name: string, quantity = 0, extra: Record<string, unknown> = {}) => ({
  name,
  sku: name.toUpperCase().replace(/\W/g, '-'),
  category: 'Food',
  sellingPrice: 10,
  costPrice: 4,
  quantity,
  trackStock: true,
  tracksExpiry: false,
  status: 'active',
  productClass: 'inventory_item',
  menuItem: false,
  isIngredient: false,
  unit: 'each',
  createdAt: Timestamp.now(),
  updatedAt: Timestamp.now(),
  ...extra
})

test.beforeEach(async ({ request }) => resetEmulators(request))

test('retail receiving, FEFO sale, receipt, movement and dashboard metric remain integrated', async ({ request, page }) => {
  const businessId = await seedBusiness('Retail E2E Business')
  const owner = await seedUser(businessId, 'owner')
  const manager = await seedUser(businessId, 'manager')
  const cashier = await seedUser(businessId, 'cashier')
  const ref = adminDb.doc(`businesses/${businessId}/products/milk`)
  await ref.set(product('Fresh Milk', 0, { tracksExpiry: true, sellingPrice: 12 }))
  const [ownerToken, managerToken, cashierToken] = await Promise.all([
    signInToken(request, owner.email), signInToken(request, manager.email), signInToken(request, cashier.email)
  ])
  const today = new Date()
  const date = (days: number) => new Date(today.getTime() + days * 86_400_000).toISOString().slice(0, 10)
  const first = await callFunction<{ batchId: string }>(request, 'receiveStock', ownerToken, { productId: 'milk', quantity: 5, supplierId: null, reference: 'A', costPrice: 4, expiryDate: date(2) })
  const second = await callFunction<{ batchId: string }>(request, 'receiveStock', managerToken, { productId: 'milk', quantity: 10, supplierId: null, reference: 'B', costPrice: 4.5, expiryDate: date(10) })
  await expectFunctionRejected(request, 'receiveStock', cashierToken, { productId: 'milk', quantity: 1, supplierId: null, reference: '', expiryDate: date(5) }, /PERMISSION_DENIED|permitted/i)
  await adminDb.doc(`businesses/${businessId}/inventoryBatches/expired`).set({ productId: 'milk', quantityRemaining: 3, quantityReceived: 3, expiryDate: date(-1), status: 'active', costPriceSnapshot: 1, createdAt: Timestamp.now() })

  const result = await callFunction<{ saleId: string; receipt: { total: number; items: unknown[] } }>(request, 'createSale', ownerToken, sale('milk', 6))
  expect(result.receipt.total).toBe(72)
  expect(result.receipt.items).toHaveLength(1)
  expect((await ref.get()).data()?.quantity).toBe(9)
  expect((await adminDb.doc(`businesses/${businessId}/inventoryBatches/${first.batchId}`).get()).data()).toMatchObject({ quantityRemaining: 0, status: 'depleted' })
  expect((await adminDb.doc(`businesses/${businessId}/inventoryBatches/${second.batchId}`).get()).data()?.quantityRemaining).toBe(9)
  expect((await adminDb.doc(`businesses/${businessId}/inventoryBatches/expired`).get()).data()?.quantityRemaining).toBe(3)
  const movement = await adminDb.collection(`businesses/${businessId}/inventoryMovements`).where('referenceId', '==', result.saleId).limit(1).get()
  expect(movement.docs[0].data()).toMatchObject({
    type: 'sale', quantityChange: -6, quantityBefore: 15, quantityAfter: 9,
    referenceId: result.saleId, createdBy: owner.uid, staffNameSnapshot: 'E2E owner'
  })
  expect(movement.docs[0].data().type).not.toBe('recipe_consumption')
  expect(movement.docs[0].data().batchAllocations).toEqual(expect.arrayContaining([{ batchId: first.batchId, quantity: 5, expiryDate: date(2) }, { batchId: second.batchId, quantity: 1, expiryDate: date(10) }]))
  await login(page, owner.email)
  await expect(page.getByText(/R\s*72,00/).first()).toBeVisible()
})

test('write-offs and a batch-aware stock count preserve aggregate and audit consistency', async ({ request }) => {
  const businessId = await seedBusiness()
  const owner = await seedUser(businessId, 'owner')
  const token = await signInToken(request, owner.email)
  await adminDb.doc(`businesses/${businessId}/products/stock`).set(product('Counted Stock', 12, { tracksExpiry: true }))
  const expiries = ['2027-01-01', '2027-02-01', '2027-03-01']
  for (let index = 0; index < 3; index++) await adminDb.doc(`businesses/${businessId}/inventoryBatches/b${index + 1}`).set({ productId: 'stock', productNameSnapshot: 'Counted Stock', quantityReceived: 4, quantityRemaining: 4, expiryDate: expiries[index], status: 'active', costPriceSnapshot: 4, createdAt: Timestamp.now() })
  for (const [index, reason] of ['damaged', 'spoiled', 'expired'].entries()) {
    await callFunction(request, 'writeOffStock', token, { productId: 'stock', batchId: `b${index + 1}`, quantity: 1, reason, notes: `${reason} QA` })
  }
  await expectFunctionRejected(request, 'writeOffStock', token, { productId: 'stock', batchId: 'b1', quantity: 99, reason: 'damaged', notes: '' }, /FAILED_PRECONDITION|Only/i)
  const count = await callFunction<{ quantityAfter: number; variance: number }>(request, 'performStockCount', token, { productId: 'stock', countedQuantity: 7, reason: 'Cycle count', notes: 'QA count' })
  expect(count).toEqual({ quantityAfter: 7, variance: -2 })
  expect((await adminDb.doc(`businesses/${businessId}/products/stock`).get()).data()?.quantity).toBe(7)
  expect((await adminDb.doc(`businesses/${businessId}/inventoryBatches/b1`).get()).data()?.quantityRemaining).toBe(1)
  const movements = await adminDb.collection(`businesses/${businessId}/inventoryMovements`).get()
  expect(movements.docs.map((doc) => doc.data().type)).toEqual(expect.arrayContaining(['damaged_write_off', 'waste', 'expiry_write_off', 'stock_count']))
})

test('promotion states and manual discount authority are enforced by the trusted backend', async ({ request }) => {
  const businessId = await seedBusiness()
  const owner = await seedUser(businessId, 'owner')
  const manager = await seedUser(businessId, 'manager')
  const supervisor = await seedUser(businessId, 'supervisor')
  const cashier = await seedUser(businessId, 'cashier')
  await adminDb.doc(`businesses/${businessId}/products/item`).set(product('Promotion Item', 100, { sellingPrice: 100, category: 'Meals' }))
  await adminDb.doc(`businesses/${businessId}/settings/operations`).set({ discountLimits: { cashier: 0, supervisor: 10, manager: 20 } })
  const tokens = Object.fromEntries(await Promise.all(Object.entries({ owner, manager, supervisor, cashier }).map(async ([role, user]) => [role, await signInToken(request, user.email)])))
  const now = Date.now()
  const definitions = {
    percentage: { type: 'percentage', value: 10 },
    fixed: { type: 'fixed', value: 5 },
    product: { type: 'product_percentage', value: 15, productId: 'item' },
    category: { type: 'category_percentage', value: 20, category: 'Meals' }
  }
  for (const [id, definition] of Object.entries(definitions)) {
    await adminDb.doc(`businesses/${businessId}/promotions/${id}`).set({ name: id, status: 'active', startsAt: Timestamp.fromMillis(now - 60_000), endsAt: Timestamp.fromMillis(now + 60_000), ...definition })
    const result = await callFunction<{ receipt: { promotionDiscount: number } }>(request, 'createSale', tokens.owner, { ...sale('item'), promotionId: id })
    expect(result.receipt.promotionDiscount).toBeGreaterThan(0)
  }
  for (const [id, status, start, end] of [['scheduled', 'active', now + 60_000, now + 120_000], ['expired', 'active', now - 120_000, now - 60_000], ['disabled', 'disabled', now - 60_000, now + 60_000]] as const) {
    await adminDb.doc(`businesses/${businessId}/promotions/${id}`).set({ name: id, type: 'percentage', value: 10, status, startsAt: Timestamp.fromMillis(start), endsAt: Timestamp.fromMillis(end) })
    await expectFunctionRejected(request, 'createSale', tokens.owner, { ...sale('item'), promotionId: id }, /FAILED_PRECONDITION|not currently active/i)
  }
  const allowed = { supervisor: 10, manager: 20, owner: 50 }
  for (const [role, discount] of Object.entries(allowed)) await expect(callFunction(request, 'createSale', tokens[role], { ...sale('item'), discount })).resolves.toBeTruthy()
  await expectFunctionRejected(request, 'createSale', tokens.cashier, { ...sale('item'), discount: 1 }, /INVALID_ARGUMENT|cannot exceed/i)
  await expectFunctionRejected(request, 'createSale', tokens.supervisor, { ...sale('item'), discount: 11 }, /INVALID_ARGUMENT|cannot exceed/i)
  await expectFunctionRejected(request, 'createSale', tokens.manager, { ...sale('item'), discount: 21 }, /INVALID_ARGUMENT|cannot exceed/i)
})

test('cross-tenant reads, trusted operations and direct inventory mutation are rejected', async ({ request }) => {
  const businessA = await seedBusiness('Business A')
  const businessB = await seedBusiness('Business B')
  const ownerA = await seedUser(businessA, 'owner', 'owner-a')
  await adminDb.doc(`businesses/${businessB}/products/private`).set(product('Private B Product', 10))
  await adminDb.doc(`businesses/${businessB}/promotions/private`).set({ name: 'B promo', type: 'percentage', value: 10, status: 'active', startsAt: Timestamp.fromMillis(Date.now() - 1000), endsAt: Timestamp.fromMillis(Date.now() + 60_000) })
  for (const name of ['members', 'recipes', 'kitchenOrders', 'inventoryBatches']) await adminDb.doc(`businesses/${businessB}/${name}/private`).set({ status: 'active', createdAt: Timestamp.now() })
  const token = await signInToken(request, ownerA.email)
  await expectFunctionRejected(request, 'createSale', token, sale('private'), /INVALID_ARGUMENT|does not exist/i)
  await expectFunctionRejected(request, 'createSale', token, { ...sale('private'), promotionId: 'private' }, /INVALID_ARGUMENT|does not exist/i)
  await expectFunctionRejected(request, 'createSale', token, { ...sale('private'), items: [{ productId: 'private', quantity: 1, price: 0.01 }] }, /INVALID_ARGUMENT|Unsupported/i)
  await expectFunctionRejected(request, 'getOperationalReport', token, { from: Date.now() - 86_400_000, to: Date.now(), businessId: businessB }, /INVALID_ARGUMENT|valid report range/i)
  const base = `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents/businesses/${businessB}`
  for (const path of ['products/private', 'members/private', 'recipes/private', 'kitchenOrders/private', 'inventoryBatches/private']) {
    const response = await request.get(`${base}/${path}`, { headers: { Authorization: `Bearer ${token}` } })
    expect(response.status(), `cross-tenant ${path}`).toBe(403)
  }
  const ownBatch = adminDb.doc(`businesses/${businessA}/inventoryBatches/protected`)
  await ownBatch.set({ productId: 'x', status: 'active', quantityRemaining: 1 })
  const mutation = await request.patch(`http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents/businesses/${businessA}/inventoryBatches/protected`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { fields: { quantityRemaining: { integerValue: '999' } } }
  })
  expect(mutation.status()).toBe(403)
})
