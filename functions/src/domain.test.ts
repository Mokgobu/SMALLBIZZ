import assert from 'node:assert/strict'
import test from 'node:test'
import { johannesburgDateKey, MAX_DISCOUNT_RATE, prepareAuthoritativeSale, validateSaleIntent } from './domain.js'
import { resolveCashierSnapshot } from './createSale.js'

const product = {
  id: 'coffee', name: 'Coffee', sku: 'COF', sellingPrice: 25.5, costPrice: 10.25,
  quantity: 10, trackStock: true, status: 'active'
}

test('sale intent accepts only user-controlled fields and combines duplicate lines', () => {
  const intent = validateSaleIntent({ items: [{ productId: 'coffee', quantity: 1 }, { productId: 'coffee', quantity: 2 }], discount: 5, paymentMethod: 'cash', notes: ' Thanks ' })
  assert.deepEqual(intent.items, [{ productId: 'coffee', quantity: 3, modifierOptionIds: [], preparationNotes: '' }])
  assert.equal(intent.notes, 'Thanks')
  assert.throws(() => validateSaleIntent({ items: [{ productId: 'coffee', quantity: 1, unitPrice: 1 }], paymentMethod: 'cash' }), /Unsupported sale field/)
  assert.throws(() => validateSaleIntent({ items: [{ productId: 'coffee', quantity: 1 }], paymentMethod: 'cash', businessId: 'other' }), /Unsupported sale field/)
})

test('intent rejects invalid quantities, payment methods, discounts, and notes', () => {
  for (const quantity of [0, -1, 1.5]) {
    assert.throws(() => validateSaleIntent({ items: [{ productId: 'coffee', quantity }], paymentMethod: 'cash' }), /positive whole numbers/)
  }
  assert.throws(() => validateSaleIntent({ items: [{ productId: 'coffee', quantity: 1 }], paymentMethod: 'crypto' }), /valid payment/)
  assert.throws(() => validateSaleIntent({ items: [{ productId: 'coffee', quantity: 1 }], paymentMethod: 'cash', discount: -1 }), /non-negative/)
  assert.throws(() => validateSaleIntent({ items: [{ productId: 'coffee', quantity: 1 }], paymentMethod: 'cash', notes: 'x'.repeat(501) }), /500/)
})

test('authoritative products determine price, cost, totals, profit, and stock', () => {
  const intent = validateSaleIntent({ items: [{ productId: 'coffee', quantity: 2 }], discount: 5, paymentMethod: 'card' })
  const result = prepareAuthoritativeSale([product], intent)
  assert.deepEqual(result.items[0], { productId: 'coffee', productName: 'Coffee', sku: 'COF', quantity: 2, unitPrice: 25.5, costPrice: 10.25, lineTotal: 51, modifiers: [], preparationNotes: '', recipeSnapshot: null, menuItem: false })
  assert.equal(result.subtotal, 51)
  assert.equal(result.totalCost, 20.5)
  assert.equal(result.total, 46)
  assert.equal(result.grossProfit, 25.5)
  assert.deepEqual(result.stockUpdates[0], { product, quantityBefore: 10, quantityAfter: 8 })
})

test('discount cap, availability, active status, and stock are enforced', () => {
  const base = validateSaleIntent({ items: [{ productId: 'coffee', quantity: 1 }], paymentMethod: 'cash' })
  assert.throws(() => prepareAuthoritativeSale([product], { ...base, discount: product.sellingPrice * MAX_DISCOUNT_RATE + 0.01 }), /20%/)
  assert.throws(() => prepareAuthoritativeSale([], base), /does not exist/)
  assert.throws(() => prepareAuthoritativeSale([{ ...product, status: 'archived' }], base), /not active/)
  assert.throws(() => prepareAuthoritativeSale([{ ...product, quantity: 0 }], base), /Insufficient stock/)
})

test('preparation notes and authoritative modifier pricing are snapshotted without trusting browser prices', () => {
  const intent = validateSaleIntent({ items: [{ productId: 'coffee', quantity: 2, modifierOptionIds: ['extra'], preparationNotes: 'Extra hot' }], paymentMethod: 'cash' })
  const result = prepareAuthoritativeSale([product], intent, { promotionDiscount: 5, lineAdjustments: [{ unitPriceDelta: 4, modifierSnapshots: [{ id: 'extra', label: 'Extra shot', priceDelta: 4 }], recipeSnapshot: { recipeId: 'coffee', version: 3, nameSnapshot: 'Coffee', ingredients: [] }, menuItem: true }] })
  assert.equal(result.subtotal, 59)
  assert.equal(result.total, 54)
  assert.equal(result.items[0].preparationNotes, 'Extra hot')
  assert.equal(result.items[0].modifiers[0].label, 'Extra shot')
  assert.equal(result.items[0].recipeSnapshot?.version, 3)
})

test('Johannesburg daily key follows tenant reporting timezone', () => {
  assert.equal(johannesburgDateKey(new Date('2026-09-07T22:30:00.000Z')), '2026-09-08')
})

test('sale attribution snapshots authoritative membership name and role with legacy fallbacks', () => {
  assert.deepEqual(resolveCashierSnapshot({ displayName: ' Cashier Neo ' }, { fullName: 'Profile name' }, {}, 'cashier'), {
    cashierNameSnapshot: 'Cashier Neo', cashierRoleSnapshot: 'cashier'
  })
  assert.deepEqual(resolveCashierSnapshot(undefined, { fullName: '' }, { name: 'Legacy owner' }, 'owner'), {
    cashierNameSnapshot: 'Legacy owner', cashierRoleSnapshot: 'owner'
  })
})
