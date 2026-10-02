import assert from 'node:assert/strict'
import test from 'node:test'
import { allocateFefo } from './inventoryDomain.js'
import { aggregateIngredientStockUpdates, assertRecipeProductReferences, canTransitionKitchenStatus, kitchenItemsForSale, nextRecipeVersion, parseRecipe, recipeAvailability, resolveRecipeLine } from './restaurantDomain.js'
import { canConvertUnits, convertQuantity } from './unitsDomain.js'

const products = new Map([
  ['bread', { id: 'bread', name: 'Bread', quantity: 20, trackStock: true, status: 'active', unit: 'slice', costPrice: 1, productClass: 'ingredient' }],
  ['egg', { id: 'egg', name: 'Eggs', quantity: 12, trackStock: true, status: 'active', unit: 'each', costPrice: 2, productClass: 'ingredient' }],
  ['cheese', { id: 'cheese', name: 'Cheese', quantity: 15, trackStock: true, status: 'active', unit: 'slice', costPrice: 1.5, productClass: 'ingredient' }],
  ['chips', { id: 'chips', name: 'Chips', quantity: 3.6, trackStock: true, status: 'active', unit: 'kg', costPrice: 30, productClass: 'ingredient' }]
])

const recipeInput = { productId: 'kota', nameSnapshot: 'Kota', version: 2, active: true, ingredients: [
  { ingredientProductId: 'bread', ingredientNameSnapshot: 'Bread', quantity: 1, unit: 'slice' },
  { ingredientProductId: 'egg', ingredientNameSnapshot: 'Eggs', quantity: 1, unit: 'each' },
  { ingredientProductId: 'cheese', ingredientNameSnapshot: 'Cheese', quantity: 1, unit: 'slice' },
  { ingredientProductId: 'chips', ingredientNameSnapshot: 'Chips', quantity: 200, unit: 'g' }
], modifierGroups: [{ id: 'extras', name: 'Extras', kind: 'multi', optional: true, maxSelections: 2, options: [
  { id: 'extra_cheese', label: 'Extra cheese', priceDelta: 5, ingredientAdjustments: [{ ingredientProductId: 'cheese', ingredientNameSnapshot: 'Cheese', quantity: 1, unit: 'slice', mode: 'add' }] },
  { id: 'no_cheese', label: 'No cheese', priceDelta: 0, ingredientAdjustments: [{ ingredientProductId: 'cheese', ingredientNameSnapshot: 'Cheese', quantity: 1, unit: 'slice', mode: 'remove' }] }
] }] }

test('server units convert only safe weight and volume families', () => {
  assert.equal(convertQuantity(200, 'g', 'kg'), 0.2)
  assert.equal(convertQuantity(1.5, 'litre', 'ml'), 1500)
  assert.equal(canConvertUnits('kg', 'ml'), false)
  assert.throws(() => convertQuantity(1, 'slice', 'each'), /Unsafe conversion/)
})

test('recipe validation rejects self references, duplicate ingredients, and invalid units', () => {
  assert.throws(() => parseRecipe({ ...recipeInput, ingredients: [{ ingredientProductId: 'kota', ingredientNameSnapshot: 'Kota', quantity: 1, unit: 'each' }] }, 'kota'), /itself/)
  assert.throws(() => parseRecipe({ ...recipeInput, ingredients: [recipeInput.ingredients[0], recipeInput.ingredients[0]] }, 'kota'), /Duplicate/)
  assert.throws(() => parseRecipe({ ...recipeInput, ingredients: [{ ...recipeInput.ingredients[0], unit: 'bucket' }] }, 'kota'), /Unsupported unit/)
})

test('availability finds the limiting ingredient and supports write-off recalculation', () => {
  const recipe = parseRecipe(recipeInput, 'kota')
  assert.deepEqual(recipeAvailability(recipe, products).limitingIngredient, { ingredientProductId: 'egg', ingredientName: 'Eggs', maxUnits: 12 })
  assert.equal(recipeAvailability(recipe, products).maxUnits, 12)
  const writtenOff = new Map(products); writtenOff.set('egg', { ...products.get('egg')!, quantity: 2 })
  assert.equal(recipeAvailability(recipe, writtenOff).maxUnits, 2)
  assert.equal(recipeAvailability(recipe, writtenOff).low, true)
})

test('modifiers affect authoritative price and ingredient totals', () => {
  const recipe = parseRecipe(recipeInput, 'kota'), resolved = resolveRecipeLine(recipe, 2, ['extra_cheese'], products)
  assert.equal(resolved.unitPriceDelta, 5)
  assert.equal(resolved.requirements.find((item) => item.product.id === 'cheese')?.stockQuantity, 4)
  const updates = aggregateIngredientStockUpdates([resolved])
  assert.equal(updates.find((item) => item.product.id === 'chips')?.quantityConsumed, 0.4)
})

test('invalid, duplicate, and conflicting modifiers are rejected', () => {
  const recipe = parseRecipe(recipeInput, 'kota')
  assert.throws(() => resolveRecipeLine(recipe, 1, ['missing'], products), /not available/)
  assert.throws(() => resolveRecipeLine(recipe, 1, ['extra_cheese', 'extra_cheese'], products), /more than once/)
  assert.throws(() => resolveRecipeLine(recipe, 1, ['extra_cheese', 'no_cheese'], products), /Conflicting/)
})

test('cross-tenant or unclassified ingredient references are rejected', () => {
  const recipe = parseRecipe(recipeInput, 'kota'), menu = { id: 'kota', name: 'Kota', quantity: 0, trackStock: false, status: 'active', unit: 'each', menuItem: true }
  const missing = new Map(products); missing.delete('egg')
  assert.throws(() => assertRecipeProductReferences(recipe, menu, missing), /does not belong/)
})

test('recipe versions advance immutably and kitchen transitions are sequential', () => {
  assert.equal(nextRecipeVersion(null), 1); assert.equal(nextRecipeVersion(3), 4)
  assert.equal(canTransitionKitchenStatus('new', 'preparing'), true)
  assert.equal(canTransitionKitchenStatus('new', 'ready'), false)
})

test('kitchen tickets contain prepared menu lines only and preserve notes/modifiers', () => {
  const items = kitchenItemsForSale([
    { productId: 'kota', productName: 'Kota', quantity: 1, menuItem: true, modifiers: [{ id: 'extra', label: 'Extra egg', priceDelta: 4 }], preparationNotes: 'Cut in half', recipeSnapshot: { recipeId: 'kota', version: 2 } },
    { productId: 'cola', productName: 'Cola', quantity: 1, menuItem: false, modifiers: [], preparationNotes: '', recipeSnapshot: null }
  ])
  assert.equal(items.length, 1); assert.equal(items[0].preparationNotes, 'Cut in half'); assert.equal(items[0].recipeVersion, 2)
})

test('FEFO excludes expired batches before recipe availability is derived', () => {
  const allocations = allocateFefo([
    { id: 'expired', quantityRemaining: 10, expiryDate: '2026-09-01', status: 'active', costPriceSnapshot: 1 },
    { id: 'valid', quantityRemaining: 3, expiryDate: '2026-09-10', status: 'active', costPriceSnapshot: 1 }
  ], 2, '2026-09-08')
  assert.deepEqual(allocations.map((item) => item.batchId), ['valid'])
})
