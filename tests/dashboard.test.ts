import assert from 'node:assert/strict'
import test from 'node:test'
import { permissionsForRole } from '../src/auth/permissions'
import { dashboardPolicy } from '../src/dashboard/dashboardPolicy'
import { summarizeCashierDashboard } from '../src/dashboard/cashierDashboard'

test('cashier dashboard uses only projected data and excludes financial metrics and actions', () => {
  const policy = dashboardPolicy(permissionsForRole('cashier'))
  assert.equal(policy.source, 'cashier')
  for (const hidden of ['monthSales', 'expenses', 'profit'] as const) assert.equal(policy.metrics.includes(hidden), false)
  assert.ok(policy.metrics.includes('todaySales'))
  assert.ok(policy.metrics.includes('transactions'))
  assert.ok(policy.metrics.includes('unitsSold'))
  assert.deepEqual(policy.actions.map((action) => action.to), ['/sales', '/products', '/promotions', '/customers'])
  assert.equal(policy.actions.some((action) => ['/inventory', '/expiry'].includes(action.to)), false)
})

test('owner dashboard retains full financial metrics and authorized quick actions', () => {
  const policy = dashboardPolicy(permissionsForRole('owner'))
  assert.equal(policy.source, 'financial')
  for (const visible of ['todaySales', 'monthSales', 'expenses', 'profit', 'lowStock', 'outOfStock', 'customers'] as const) {
    assert.ok(policy.metrics.includes(visible))
  }
  assert.ok(policy.actions.some((action) => action.to === '/inventory'))
  assert.ok(policy.actions.some((action) => action.to === '/expiry'))
})

test('supervisor dashboard uses sanitized operational reporting without owner financial cards', () => {
  const policy = dashboardPolicy(permissionsForRole('supervisor'))
  assert.equal(policy.source, 'operational')
  assert.ok(policy.metrics.includes('monthSales'))
  assert.equal(policy.metrics.includes('expenses'), false)
  assert.equal(policy.metrics.includes('profit'), false)
})

test('cashier dashboard summary calculates authorized activity without cost or profit input', () => {
  const stats = summarizeCashierDashboard([
    {
      id: 'sale-1', items: [{ productId: 'kota', productName: 'Kota', sku: 'K1', quantity: 2, unitPrice: 30, lineTotal: 60 }],
      itemCount: 2, subtotal: 60, discount: 0, total: 60, paymentMethod: 'cash', notes: '', customerId: null,
      customerNameSnapshot: null, cashierNameSnapshot: 'Cashier', cashierRoleSnapshot: 'cashier',
      createdAt: new Date('2026-09-30T08:00:00+02:00').getTime(), createdBy: 'cashier-1'
    },
    {
      id: 'sale-2', items: [{ productId: 'chips', productName: 'Chips', sku: 'C1', quantity: 1, unitPrice: 10, lineTotal: 10 }],
      itemCount: 1, subtotal: 10, discount: 0, total: 10, paymentMethod: 'card', notes: '', customerId: null,
      customerNameSnapshot: null, createdAt: new Date('2026-09-29T08:00:00+02:00').getTime(), createdBy: 'cashier-1'
    }
  ], [
    { id: 'kota', name: 'Kota', description: '', sku: 'K1', barcode: '', category: 'Food', sellingPrice: 30, quantity: 1, reorderLevel: 2, trackStock: true, unit: 'item', status: 'active', lastMovementId: null, createdBy: 'owner' },
    { id: 'drink', name: 'Drink', description: '', sku: 'D1', barcode: '', category: 'Drinks', sellingPrice: 15, quantity: 0, reorderLevel: 2, trackStock: true, unit: 'item', status: 'active', lastMovementId: null, createdBy: 'owner' }
  ], 4, new Date('2026-09-30T12:00:00+02:00'))

  assert.equal(stats.todaysSales, 60)
  assert.equal(stats.todayTransactions, 1)
  assert.equal(stats.todayUnitsSold, 2)
  assert.equal(stats.lowStockCount, 1)
  assert.equal(stats.outOfStockCount, 1)
  assert.equal(stats.totalCustomers, 4)
  assert.equal(stats.bestSeller, 'Kota')
  assert.equal(stats.estimatedProfit, 0)
  assert.equal(stats.expenses, 0)
  assert.equal(stats.recentSales[0].grossProfit, 0)
})
