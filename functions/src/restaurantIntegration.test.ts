import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareAuthoritativeSale, validateSaleIntent } from './domain.js'
import { allocateFefo } from './inventoryDomain.js'
import { aggregateIngredientStockUpdates, kitchenItemsForSale, parseRecipe, recipeAvailability, resolveRecipeLine } from './restaurantDomain.js'

test('restaurant checkout integrates modifiers, promotion, FEFO, kitchen and receipt snapshots', () => {
  const catalog = new Map([
    ['cheese', { id: 'cheese', name: 'Cheese', quantity: 10, trackStock: true, tracksExpiry: true, status: 'active', unit: 'slice', costPrice: 2, productClass: 'ingredient' }],
    ['chips', { id: 'chips', name: 'Chips', quantity: 2, trackStock: true, tracksExpiry: true, status: 'active', unit: 'kg', costPrice: 25, productClass: 'ingredient' }]
  ])
  const recipe = parseRecipe({ productId: 'kota', nameSnapshot: 'Kota', version: 4, active: true, ingredients: [
    { ingredientProductId: 'cheese', ingredientNameSnapshot: 'Cheese', quantity: 1, unit: 'slice' },
    { ingredientProductId: 'chips', ingredientNameSnapshot: 'Chips', quantity: 200, unit: 'g' }
  ], modifierGroups: [{ id: 'extras', name: 'Extras', kind: 'multi', optional: true, maxSelections: 1, options: [{ id: 'extra_cheese', label: 'Extra cheese', priceDelta: 5, ingredientAdjustments: [{ ingredientProductId: 'cheese', ingredientNameSnapshot: 'Cheese', quantity: 1, unit: 'slice', mode: 'add' }] }] }] }, 'kota')
  const intent = validateSaleIntent({ items: [{ productId: 'kota', quantity: 2, modifierOptionIds: ['extra_cheese'], preparationNotes: 'Cut in half' }], promotionId: 'lunch', paymentMethod: 'cash' })
  const resolved = resolveRecipeLine(recipe, 2, intent.items[0].modifierOptionIds, catalog)
  const ingredientUpdates = aggregateIngredientStockUpdates([resolved])
  assert.equal(ingredientUpdates.find((item) => item.product.id === 'cheese')?.quantityAfter, 6)
  assert.equal(ingredientUpdates.find((item) => item.product.id === 'chips')?.quantityAfter, 1.6)
  const prepared = prepareAuthoritativeSale([{ id: 'kota', name: 'Kota', sku: 'KOTA', sellingPrice: 30, costPrice: 0, quantity: 0, trackStock: false, status: 'active' }], intent, { promotionDiscount: 5, lineAdjustments: [{ unitPriceDelta: resolved.unitPriceDelta, unitCostOverride: 9, modifierSnapshots: resolved.modifierSnapshots, recipeSnapshot: resolved.recipeSnapshot, menuItem: true }] })
  assert.equal(prepared.subtotal, 70); assert.equal(prepared.total, 65); assert.equal(prepared.items[0].recipeSnapshot?.version, 4)
  assert.deepEqual(allocateFefo([
    { id: 'expired', quantityRemaining: 1, expiryDate: '2026-09-07', status: 'active', costPriceSnapshot: 20 },
    { id: 'quarantine', quantityRemaining: 1, expiryDate: '2026-09-09', status: 'quarantined', costPriceSnapshot: 20 },
    { id: 'valid-first', quantityRemaining: 0.25, expiryDate: '2026-09-10', status: 'active', costPriceSnapshot: 25 },
    { id: 'valid-next', quantityRemaining: 1, expiryDate: '2026-09-12', status: 'active', costPriceSnapshot: 25 }
  ], 0.4, '2026-09-08').map((item) => [item.batchId, item.quantity]), [['valid-first', 0.25], ['valid-next', 0.15]])
  const kitchen = kitchenItemsForSale(prepared.items)
  assert.equal(kitchen.length, 1); assert.equal(kitchen[0].preparationNotes, 'Cut in half'); assert.equal(kitchen[0].modifiers[0].label, 'Extra cheese')
  assert.equal(recipeAvailability(recipe, catalog).available, true)
})
