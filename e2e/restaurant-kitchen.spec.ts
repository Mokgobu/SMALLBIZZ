import { expect, test } from '@playwright/test'
import { Timestamp } from 'firebase-admin/firestore'
import { adminDb, callFunction, expectFunctionRejected, resetEmulators, seedBusiness, seedUser, signInToken } from './support/emulator'

const baseProduct = (name: string, quantity: number, unit: string, extra: Record<string, unknown> = {}) => ({
  name,
  sku: name.toUpperCase(),
  category: 'Kota',
  sellingPrice: 0,
  costPrice: 1,
  quantity,
  trackStock: true,
  tracksExpiry: false,
  status: 'active',
  productClass: 'ingredient',
  isIngredient: true,
  menuItem: false,
  unit,
  createdAt: Timestamp.now(),
  updatedAt: Timestamp.now(),
  ...extra
})

test.beforeEach(async ({ request }) => resetEmulators(request))

test('Full Kota recipe, modifiers, recipe FEFO, receipt and kitchen lifecycle are authoritative', async ({ request }) => {
  const businessId = await seedBusiness('Kota E2E Kitchen')
  const owner = await seedUser(businessId, 'owner')
  const cashier = await seedUser(businessId, 'cashier')
  const [ownerToken, cashierToken] = await Promise.all([signInToken(request, owner.email), signInToken(request, cashier.email)])
  const ingredients = {
    bread: ['Bread', 20, 'each'],
    egg: ['Egg', 20, 'each'],
    polony: ['Polony', 30, 'slice'],
    cheese: ['Cheese', 10, 'slice'],
    chips: ['Chips', 2000, 'g'],
    sauce: ['Sauce', 500, 'ml']
  } as const
  for (const [id, [name, quantity, unit]] of Object.entries(ingredients)) {
    await adminDb.doc(`businesses/${businessId}/products/${id}`).set(baseProduct(name, quantity, unit, id === 'cheese' ? { tracksExpiry: true } : {}))
  }
  await adminDb.doc(`businesses/${businessId}/products/full-kota`).set(baseProduct('Full Kota', 0, 'each', { sellingPrice: 55, costPrice: 0, trackStock: false, productClass: 'menu_item', isIngredient: false, menuItem: true, recipeId: 'full-kota' }))
  const recipe = {
    productId: 'full-kota', nameSnapshot: 'Full Kota', version: 1, active: true,
    ingredients: [
      ['bread', 'Bread', 1, 'each'], ['egg', 'Egg', 1, 'each'], ['polony', 'Polony', 2, 'slice'],
      ['cheese', 'Cheese', 1, 'slice'], ['chips', 'Chips', 100, 'g'], ['sauce', 'Sauce', 20, 'ml']
    ].map(([ingredientProductId, ingredientNameSnapshot, quantity, unit]) => ({ ingredientProductId, ingredientNameSnapshot, quantity, unit })),
    modifierGroups: [{ id: 'cheese-choice', name: 'Cheese choice', kind: 'single', optional: true, maxSelections: 1, options: [
      { id: 'extra-cheese', label: 'Extra cheese', priceDelta: 8, ingredientAdjustments: [{ ingredientProductId: 'cheese', ingredientNameSnapshot: 'Cheese', quantity: 1, unit: 'slice', mode: 'add' }] },
      { id: 'no-cheese', label: 'No cheese', priceDelta: 0, ingredientAdjustments: [{ ingredientProductId: 'cheese', ingredientNameSnapshot: 'Cheese', quantity: 1, unit: 'slice', mode: 'remove' }] }
    ]}],
    createdAt: Timestamp.now(), updatedAt: Timestamp.now(), createdBy: owner.uid, updatedBy: owner.uid
  }
  await adminDb.doc(`businesses/${businessId}/recipes/full-kota`).set(recipe)
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
  const nextWeek = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  for (const [id, quantityRemaining, expiryDate, status] of [['early', 3, tomorrow, 'active'], ['late', 7, nextWeek, 'active'], ['expired', 5, yesterday, 'active'], ['quarantined', 5, tomorrow, 'quarantined']] as const) {
    await adminDb.doc(`businesses/${businessId}/inventoryBatches/${id}`).set({ productId: 'cheese', productNameSnapshot: 'Cheese', quantityReceived: quantityRemaining, quantityRemaining, expiryDate, status, costPriceSnapshot: 1, createdAt: Timestamp.now() })
  }

  const intent = { items: [{ productId: 'full-kota', quantity: 2, modifierOptionIds: ['extra-cheese'], preparationNotes: 'Toast well' }], customerId: null, discount: 0, promotionId: null, paymentMethod: 'cash', notes: '' }
  const first = await callFunction<{ saleId: string; receipt: { total: number; items: Array<{ modifiers: unknown[]; recipeSnapshot: { version: number } }> } }>(request, 'createSale', cashierToken, intent)
  expect(first.receipt.total).toBe(126)
  expect(first.receipt.items[0].modifiers).toHaveLength(1)
  expect(first.receipt.items[0].recipeSnapshot.version).toBe(1)
  const expected = { bread: 18, egg: 18, polony: 26, cheese: 6, chips: 1800, sauce: 460 }
  for (const [id, quantity] of Object.entries(expected)) expect((await adminDb.doc(`businesses/${businessId}/products/${id}`).get()).data()?.quantity, id).toBe(quantity)
  expect((await adminDb.doc(`businesses/${businessId}/inventoryBatches/early`).get()).data()).toMatchObject({ quantityRemaining: 0, status: 'depleted' })
  expect((await adminDb.doc(`businesses/${businessId}/inventoryBatches/late`).get()).data()?.quantityRemaining).toBe(6)
  expect((await adminDb.doc(`businesses/${businessId}/inventoryBatches/expired`).get()).data()?.quantityRemaining).toBe(5)
  expect((await adminDb.doc(`businesses/${businessId}/inventoryBatches/quarantined`).get()).data()?.quantityRemaining).toBe(5)
  const ingredientMovements = await adminDb.collection(`businesses/${businessId}/inventoryMovements`).where('referenceId', '==', first.saleId).get()
  expect(ingredientMovements.size).toBe(Object.keys(ingredients).length)
  expect(ingredientMovements.docs.every((movement) => movement.data().type === 'recipe_consumption')).toBe(true)
  expect(ingredientMovements.docs.every((movement) => movement.data().createdBy === cashier.uid)).toBe(true)
  const cheeseMovement = ingredientMovements.docs.find((movement) => movement.data().productId === 'cheese')?.data()
  expect(cheeseMovement).toMatchObject({ quantityChange: -4, quantityBefore: 10, quantityAfter: 6, referenceId: first.saleId })
  expect(cheeseMovement?.batchAllocations).toEqual(expect.arrayContaining([{ batchId: 'early', quantity: 3, expiryDate: tomorrow }, { batchId: 'late', quantity: 1, expiryDate: nextWeek }]))
  expect((await adminDb.doc(`businesses/${businessId}/kitchenOrders/${first.saleId}`).get()).data()).toMatchObject({ status: 'new', saleId: first.saleId })

  const cheeseBefore = (await adminDb.doc(`businesses/${businessId}/products/cheese`).get()).data()?.quantity
  const noCheese = { ...intent, items: [{ productId: 'full-kota', quantity: 1, modifierOptionIds: ['no-cheese'], preparationNotes: '' }] }
  const second = await callFunction<{ receipt: { total: number; items: Array<{ modifiers: Array<{ label: string }> }> } }>(request, 'createSale', cashierToken, noCheese)
  expect(second.receipt.total).toBe(55)
  expect(second.receipt.items[0].modifiers[0].label).toBe('No cheese')
  expect((await adminDb.doc(`businesses/${businessId}/products/cheese`).get()).data()?.quantity).toBe(cheeseBefore)
  await expectFunctionRejected(request, 'createSale', cashierToken, { ...intent, items: [{ productId: 'full-kota', quantity: 1, modifierOptionIds: ['fabricated'], preparationNotes: '' }] }, /INVALID_ARGUMENT|not available/i)
  await expectFunctionRejected(request, 'createSale', cashierToken, { ...intent, arbitraryIngredientQuantity: 0 }, /INVALID_ARGUMENT|Unsupported/i)

  for (const status of ['preparing', 'ready', 'completed'] as const) await callFunction(request, 'updateKitchenOrderStatus', ownerToken, { orderId: first.saleId, status })
  expect((await adminDb.doc(`businesses/${businessId}/kitchenOrders/${first.saleId}`).get()).data()?.status).toBe('completed')
  const audit = await adminDb.collection(`businesses/${businessId}/kitchenOrderActivity`).where('orderId', '==', first.saleId).get()
  expect(audit.size).toBe(4)
  await expectFunctionRejected(request, 'updateKitchenOrderStatus', cashierToken, { orderId: first.saleId, status: 'preparing' }, /PERMISSION_DENIED|permitted/i)

  await adminDb.doc(`businesses/${businessId}/products/foreign-ingredient`).set(baseProduct('Foreign', 1, 'each'))
  await expectFunctionRejected(request, 'saveRecipe', ownerToken, { ...recipe, productId: 'full-kota', ingredients: [{ ingredientProductId: 'missing-tenant-product', ingredientNameSnapshot: 'Fake', quantity: 1, unit: 'each' }] }, /INVALID_ARGUMENT|does not belong/i)
})
