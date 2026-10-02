import { expect, test } from '@playwright/test'
import { Timestamp } from 'firebase-admin/firestore'
import { adminAuth, adminDb, callFunction, seedBusiness, seedUser, signInToken } from './support/emulator'

const createdUserIds: string[] = []
let createdBusinessId: string | null = null

test.afterAll(async () => {
  await Promise.all(createdUserIds.map((uid) => adminAuth.deleteUser(uid).catch(() => undefined)))
  if (createdBusinessId) await adminDb.recursiveDelete(adminDb.doc(`businesses/${createdBusinessId}`)).catch(() => undefined)
  await Promise.all(createdUserIds.map((uid) => adminDb.doc(`users/${uid}`).delete().catch(() => undefined)))
})

const product = (name: string, quantity: number, extra: Record<string, unknown> = {}) => ({
  name, description: '', sku: name.toUpperCase().replace(/\W/g, '-'), barcode: '', category: 'QA',
  sellingPrice: 20, costPrice: 8, quantity, reorderLevel: 1, trackStock: true, tracksExpiry: true,
  status: 'active', productClass: 'inventory_item', menuItem: false, recipeId: null, isIngredient: false,
  unit: 'each', createdAt: Timestamp.now(), updatedAt: Timestamp.now(), createdBy: 'e2e', ...extra
})

const intent = (productId: string, quantity: number) => ({
  items: [{ productId, quantity, modifierOptionIds: [], preparationNotes: '' }],
  customerId: null, discount: 0, promotionId: null, paymentMethod: 'cash', notes: ''
})

test('cashier retail and recipe sales preserve FEFO with distinct movement semantics', async ({ request }) => {
  test.setTimeout(180_000)
  createdBusinessId = await seedBusiness(`Movement Semantics ${Date.now()}`)
  const owner = await seedUser(createdBusinessId, 'owner', 'movement-owner')
  const cashier = await seedUser(createdBusinessId, 'cashier', 'movement-cashier')
  createdUserIds.push(owner.uid, cashier.uid)
  const [ownerToken, cashierToken] = await Promise.all([signInToken(request, owner.email), signInToken(request, cashier.email)])
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)

  await Promise.all([
    adminDb.doc(`businesses/${createdBusinessId}/products/cola`).set(product('Coca Cola', 6)),
    adminDb.doc(`businesses/${createdBusinessId}/products/cheese`).set(product('Cheese', 6, { sellingPrice: 0, productClass: 'ingredient', isIngredient: true, unit: 'slice' })),
    adminDb.doc(`businesses/${createdBusinessId}/products/kota`).set(product('Kota', 0, { sellingPrice: 50, costPrice: 0, trackStock: false, tracksExpiry: false, productClass: 'menu_item', menuItem: true, recipeId: 'kota' })),
    adminDb.doc(`businesses/${createdBusinessId}/inventoryBatches/cola-early`).set({ productId: 'cola', productNameSnapshot: 'Coca Cola', quantityReceived: 2, quantityRemaining: 2, expiryDate: tomorrow, status: 'active', costPriceSnapshot: 8, createdAt: Timestamp.now() }),
    adminDb.doc(`businesses/${createdBusinessId}/inventoryBatches/cola-late`).set({ productId: 'cola', productNameSnapshot: 'Coca Cola', quantityReceived: 4, quantityRemaining: 4, expiryDate: nextWeek, status: 'active', costPriceSnapshot: 9, createdAt: Timestamp.now() }),
    adminDb.doc(`businesses/${createdBusinessId}/inventoryBatches/cheese-early`).set({ productId: 'cheese', productNameSnapshot: 'Cheese', quantityReceived: 1, quantityRemaining: 1, expiryDate: tomorrow, status: 'active', costPriceSnapshot: 2, createdAt: Timestamp.now() }),
    adminDb.doc(`businesses/${createdBusinessId}/inventoryBatches/cheese-late`).set({ productId: 'cheese', productNameSnapshot: 'Cheese', quantityReceived: 5, quantityRemaining: 5, expiryDate: nextWeek, status: 'active', costPriceSnapshot: 2.5, createdAt: Timestamp.now() }),
    adminDb.doc(`businesses/${createdBusinessId}/recipes/kota`).set({
      productId: 'kota', nameSnapshot: 'Kota', version: 1, active: true,
      ingredients: [{ ingredientProductId: 'cheese', ingredientNameSnapshot: 'Cheese', quantity: 2, unit: 'slice' }],
      modifierGroups: [], createdAt: Timestamp.now(), updatedAt: Timestamp.now(), createdBy: owner.uid, updatedBy: owner.uid
    })
  ])

  const retail = await callFunction<{ saleId: string }>(request, 'createSale', cashierToken, intent('cola', 3))
  expect((await adminDb.doc(`businesses/${createdBusinessId}/products/cola`).get()).data()?.quantity).toBe(3)
  expect((await adminDb.doc(`businesses/${createdBusinessId}/inventoryBatches/cola-early`).get()).data()).toMatchObject({ quantityRemaining: 0, status: 'depleted' })
  expect((await adminDb.doc(`businesses/${createdBusinessId}/inventoryBatches/cola-late`).get()).data()?.quantityRemaining).toBe(3)
  const retailMovements = await adminDb.collection(`businesses/${createdBusinessId}/inventoryMovements`).where('referenceId', '==', retail.saleId).get()
  expect(retailMovements.size).toBe(1)
  expect(retailMovements.docs[0].data()).toMatchObject({
    productId: 'cola', type: 'sale', quantityChange: -3, quantityBefore: 6, quantityAfter: 3,
    referenceId: retail.saleId, createdBy: cashier.uid, staffNameSnapshot: 'E2E cashier'
  })
  expect(retailMovements.docs[0].data().type).not.toBe('recipe_consumption')
  expect(retailMovements.docs[0].data().batchAllocations).toEqual([
    { batchId: 'cola-early', quantity: 2, expiryDate: tomorrow },
    { batchId: 'cola-late', quantity: 1, expiryDate: nextWeek }
  ])

  const restaurant = await callFunction<{ saleId: string }>(request, 'createSale', cashierToken, intent('kota', 1))
  expect((await adminDb.doc(`businesses/${createdBusinessId}/products/cheese`).get()).data()?.quantity).toBe(4)
  expect((await adminDb.doc(`businesses/${createdBusinessId}/inventoryBatches/cheese-early`).get()).data()).toMatchObject({ quantityRemaining: 0, status: 'depleted' })
  expect((await adminDb.doc(`businesses/${createdBusinessId}/inventoryBatches/cheese-late`).get()).data()?.quantityRemaining).toBe(4)
  const ingredientMovements = await adminDb.collection(`businesses/${createdBusinessId}/inventoryMovements`).where('referenceId', '==', restaurant.saleId).get()
  expect(ingredientMovements.size).toBe(1)
  expect(ingredientMovements.docs[0].data()).toMatchObject({
    productId: 'cheese', type: 'recipe_consumption', quantityChange: -2, quantityBefore: 6, quantityAfter: 4,
    referenceId: restaurant.saleId, createdBy: cashier.uid, staffNameSnapshot: 'E2E cashier'
  })
  expect(ingredientMovements.docs[0].data().batchAllocations).toEqual([
    { batchId: 'cheese-early', quantity: 1, expiryDate: tomorrow },
    { batchId: 'cheese-late', quantity: 1, expiryDate: nextWeek }
  ])

  const ownerSales = await callFunction<{ sales: Array<{ id: string; createdBy: string; cashierRoleSnapshot: string }> }>(request, 'listOperationalSales', ownerToken, {})
  expect(ownerSales.sales.filter((sale) => [retail.saleId, restaurant.saleId].includes(sale.id))).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: retail.saleId, createdBy: cashier.uid, cashierRoleSnapshot: 'cashier' }),
    expect.objectContaining({ id: restaurant.saleId, createdBy: cashier.uid, cashierRoleSnapshot: 'cashier' })
  ]))
})
