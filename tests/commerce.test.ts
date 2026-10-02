import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildInventoryMovement,
  calculateStockAdjustment,
  prepareSale,
  validateProductInput,
  validateTenantContext
} from '../src/domain/commerce'
import type { Product } from '../src/models/product'

const product: Product = {
  id: 'product-a', name: 'Coffee', description: '', sku: 'COF-1', barcode: '', category: 'Drinks',
  sellingPrice: 10, costPrice: 4, quantity: 5, reorderLevel: 2, trackStock: true,
  unit: 'item', status: 'active', lastMovementId: null, createdBy: 'user-a'
}

test('product validation normalizes values and rejects invalid stock', () => {
  const valid = validateProductInput({ ...product, name: ' Coffee ', sellingPrice: 12.345 })
  assert.equal(valid.name, 'Coffee')
  assert.equal(valid.sellingPrice, 12.35)
  assert.throws(() => validateProductInput({ ...product, quantity: -1 }), /non-negative number/)
})

test('stock adjustments apply direction and prevent negative inventory', () => {
  assert.deepEqual(calculateStockAdjustment(5, 'stock_in', 3), { quantityChange: 3, quantityAfter: 8 })
  assert.deepEqual(calculateStockAdjustment(5, 'damaged', 2), { quantityChange: -2, quantityAfter: 3 })
  assert.throws(() => calculateStockAdjustment(1, 'stock_out', 2), /make stock negative/)
})

test('sale totals use product snapshots and produce stock deductions', () => {
  const sale = prepareSale([product], {
    items: [{ productId: product.id, quantity: 2 }], discount: 2, paymentMethod: 'cash', notes: 'Test'
  })
  assert.equal(sale.subtotal, 20)
  assert.equal(sale.total, 18)
  assert.equal(sale.grossProfit, 10)
  assert.deepEqual(sale.stockUpdates.map(({ quantityBefore, quantityAfter }) => ({ quantityBefore, quantityAfter })), [{ quantityBefore: 5, quantityAfter: 3 }])
  assert.deepEqual(sale.items[0], {
    productId: 'product-a', productName: 'Coffee', sku: 'COF-1', quantity: 2,
    unitPrice: 10, costPrice: 4, lineTotal: 20
  })
})

test('sale preparation rejects insufficient stock', () => {
  assert.throws(() => prepareSale([product], {
    items: [{ productId: product.id, quantity: 6 }], discount: 0, paymentMethod: 'card', notes: ''
  }), /Insufficient stock/)
})

test('inventory movement snapshots preserve the audit calculation', () => {
  assert.deepEqual(buildInventoryMovement(product, 'sale', 5, 3, 'Sale', 'sale-a', 'user-a'), {
    productId: 'product-a', productName: 'Coffee', type: 'sale', quantityChange: -2,
    quantityBefore: 5, quantityAfter: 3, reason: 'Sale', referenceId: 'sale-a', createdBy: 'user-a'
  })
})

test('tenant operations require both authenticated identifiers', () => {
  assert.doesNotThrow(() => validateTenantContext('business-a', 'user-a'))
  assert.throws(() => validateTenantContext('', 'user-a'), /authenticated business/)
  assert.throws(() => validateTenantContext('business-a', ''), /authenticated business/)
})
