import assert from 'node:assert/strict'
import test from 'node:test'
import { publicProduct, publicSale } from './operations.js'

test('operational product projections omit cost data', () => {
  const projected = publicProduct('p1', { name: 'Coffee', sellingPrice: 20, costPrice: 8, quantity: 4, reorderLevel: 2, trackStock: true })
  assert.equal('costPrice' in projected, false)
  assert.equal(projected.sellingPrice, 20)
})

test('operational sale projections omit profit and item cost snapshots', () => {
  const projected = publicSale('s1', { items: [{ productId: 'p1', productName: 'Coffee', quantity: 1, unitPrice: 20, costPrice: 8, lineTotal: 20 }], total: 20, grossProfit: 12, totalCost: 8 })
  assert.equal('grossProfit' in projected, false)
  assert.equal('totalCost' in projected, false)
  assert.equal('costPrice' in projected.items[0], false)
})
