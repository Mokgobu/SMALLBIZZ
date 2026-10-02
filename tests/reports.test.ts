import assert from 'node:assert/strict'
import test from 'node:test'
import { escapeCsvField, expensesCsv, productsCsv, salesCsv } from '../src/domain/csv'
import { calculateReport, filterReportDataByRange, resolveReportDateRange, type ReportSourceData } from '../src/domain/reports'
import { inventoryMovementLabel, isRecipeIngredientConsumption } from '../src/domain/inventoryMovements'
import type { Customer } from '../src/models/customer'
import type { Expense } from '../src/models/expense'
import type { InventoryMovement } from '../src/models/inventory'
import type { Product } from '../src/models/product'
import type { PaymentMethod, Sale } from '../src/models/sale'

const sale = (id: string, options: {
  date: string; productId: string; productName: string; quantity: number; unitPrice: number;
  costPrice: number; discount?: number; payment?: PaymentMethod; customerId?: string | null; customerName?: string | null
}): Sale => {
  const subtotal = options.quantity * options.unitPrice
  const discount = options.discount ?? 0
  return {
    id,
    items: [{ productId: options.productId, productName: options.productName, sku: `${options.productId}-sku`, quantity: options.quantity, unitPrice: options.unitPrice, costPrice: options.costPrice, lineTotal: subtotal }],
    itemCount: options.quantity,
    subtotal,
    discount,
    total: subtotal - discount,
    grossProfit: subtotal - discount - options.quantity * options.costPrice,
    paymentMethod: options.payment ?? 'cash',
    notes: '',
    customerId: options.customerId ?? null,
    customerNameSnapshot: options.customerName ?? null,
    createdAt: new Date(options.date),
    createdBy: 'user-a'
  }
}

const product = (id: string, quantity: number, reorderLevel: number, status: 'active' | 'archived' = 'active'): Product => ({
  id, name: id, description: '', sku: `${id}-sku`, barcode: '', category: 'general', sellingPrice: 100,
  costPrice: 50, quantity, reorderLevel, trackStock: true, unit: 'item', status,
  lastMovementId: null, createdBy: 'user-a'
})

const customer = (id: string, status: 'active' | 'archived' = 'active'): Customer => ({
  id, firstName: id, lastName: '', displayName: id, phone: '', email: '', birthday: null,
  notes: '', status, createdBy: 'user-a'
})

const expense = (id: string, amount: number, category: Expense['category'], date: string, status: Expense['status'] = 'active'): Expense => ({
  id, description: 'Office cost', category, amount, expenseDate: new Date(date), paymentMethod: 'eft',
  supplierId: null, supplierNameSnapshot: null, reference: '', notes: '', status, createdBy: 'user-a'
})

const movement = (date: string): InventoryMovement => ({
  id: 'movement-1', productId: 'widget', productName: 'Widget', type: 'sale', quantityChange: -1,
  quantityBefore: 2, quantityAfter: 1, reason: 'Sale', referenceId: 'sale-1', createdAt: new Date(date), createdBy: 'user-a'
})

const source = (): ReportSourceData => ({
  sales: [
    sale('sale-1', { date: '2026-09-08T10:00:00Z', productId: 'widget', productName: 'Widget snapshot', quantity: 2, unitPrice: 100, costPrice: 60, discount: 20, customerId: 'ada', customerName: 'Ada Archived' }),
    sale('sale-2', { date: '2026-09-08T11:00:00Z', productId: 'gadget', productName: 'Gadget snapshot', quantity: 1, unitPrice: 50, costPrice: 20, payment: 'card', customerId: 'bob', customerName: 'Bob Deleted' })
  ],
  expenses: [expense('expense-1', 30, 'rent', '2026-09-08T12:00:00Z'), expense('expense-archived', 999, 'other', '2026-09-08T12:00:00Z', 'archived')],
  products: [product('widget', 2, 5), product('gadget', 0, 2), product('archived-product', 8, 10, 'archived')],
  customers: [customer('ada', 'archived'), customer('current-active')],
  inventoryMovements: [movement('2026-09-08T10:00:00Z')]
})

test('report totals calculate sales, discounts, COGS, expenses, profit, and averages', () => {
  const report = calculateReport(source())
  assert.deepEqual({
    grossSales: report.grossSales,
    discounts: report.discounts,
    netSales: report.netSales,
    cogs: report.estimatedCogs,
    grossProfit: report.estimatedGrossProfit,
    expenses: report.expenses,
    operatingProfit: report.estimatedOperatingProfit,
    average: report.averageSaleValue,
    transactions: report.transactionCount,
    units: report.unitsSold
  }, { grossSales: 250, discounts: 20, netSales: 230, cogs: 140, grossProfit: 90, expenses: 30, operatingProfit: 60, average: 115, transactions: 2, units: 3 })
})

test('report rankings use immutable snapshots even when products or customers are archived/deleted', () => {
  const report = calculateReport(source())
  assert.equal(report.bestSellingProducts[0]?.productName, 'Widget snapshot')
  assert.equal(report.highestRevenueProducts[0]?.revenue, 200)
  assert.deepEqual(report.payments.map((item) => [item.paymentMethod, item.netSales]), [['cash', 180], ['card', 50]])
  assert.deepEqual(report.expensesByCategory.map((item) => [item.category, item.amount]), [['rent', 30]])
  assert.deepEqual(report.topCustomers.map((item) => [item.customerName, item.totalSpend]), [['Ada Archived', 180], ['Bob Deleted', 50]])
  assert.equal(report.activeCustomerCount, 1)
  assert.equal(report.lowStockProducts[0]?.id, 'widget')
  assert.equal(report.outOfStockProducts[0]?.id, 'gadget')
})

test('date-range filtering uses an inclusive start and exclusive end', () => {
  const data = source()
  data.sales.push(sale('outside', { date: '2026-09-09T00:00:00Z', productId: 'late', productName: 'Late', quantity: 1, unitPrice: 999, costPrice: 1 }))
  const range = resolveReportDateRange('custom', new Date('2026-09-08T12:00:00Z'), { from: '2026-09-08', to: '2026-09-08' })
  const filtered = filterReportDataByRange(data, range)
  assert.equal(filtered.sales.length, 2)
  assert.equal(calculateReport(data, range).netSales, 230)
})

test('empty and zero-sales periods return deterministic zero metrics', () => {
  const report = calculateReport({ sales: [], expenses: [], products: [], customers: [], inventoryMovements: [] })
  assert.equal(report.netSales, 0)
  assert.equal(report.averageSaleValue, 0)
  assert.equal(report.estimatedOperatingProfit, 0)
  assert.deepEqual(report.bestSellingProducts, [])
})

test('ingredient usage includes recipe consumption and excludes direct retail sale movements across historical formats', () => {
  const data = source()
  data.inventoryMovements = [
    {
      ...movement('2026-09-08T10:00:00Z'), id: 'new-retail', productId: 'cola', productName: 'Coca Cola',
      type: 'sale', reason: 'Stock deducted by sale', quantityBefore: 12, quantityAfter: 11
    },
    {
      ...movement('2026-09-08T10:01:00Z'), id: 'legacy-retail', productId: 'milk', productName: 'Fresh Milk 2L',
      type: 'recipe_consumption', reason: 'Stock deducted by sale', quantityBefore: 8, quantityAfter: 7
    },
    {
      ...movement('2026-09-08T10:02:00Z'), id: 'new-recipe', productId: 'bread', productName: 'Bread',
      type: 'recipe_consumption', reason: 'Ingredient consumed by menu sale', notes: 'Recipe ingredient consumption', unit: 'each',
      menuItems: [{ productId: 'kota', productName: 'Kota', recipeVersion: 2 }], quantityBefore: 20, quantityAfter: 18, quantityChange: -2
    },
    {
      ...movement('2026-09-08T10:03:00Z'), id: 'legacy-recipe', productId: 'cheese', productName: 'Cheese',
      type: 'sale', reason: 'Ingredient consumed by menu sale', notes: 'Recipe ingredient consumption', unit: 'slice',
      menuItems: [{ productId: 'kota', productName: 'Kota', recipeVersion: 2 }], quantityBefore: 10, quantityAfter: 9
    }
  ]

  const report = calculateReport(data)
  assert.deepEqual(report.restaurant.ingredientUsage.map((item) => [item.productId, item.quantity]), [['bread', 2], ['cheese', 1]])
  assert.equal(isRecipeIngredientConsumption(data.inventoryMovements[0]), false)
  assert.equal(isRecipeIngredientConsumption(data.inventoryMovements[1]), false)
  assert.equal(inventoryMovementLabel(data.inventoryMovements[0]), 'POS sale')
  assert.equal(inventoryMovementLabel(data.inventoryMovements[1]), 'POS sale')
  assert.equal(inventoryMovementLabel(data.inventoryMovements[2]), 'Recipe consumption')
  assert.equal(inventoryMovementLabel(data.inventoryMovements[3]), 'Recipe consumption')
  assert.equal(report.unitsSold, 3)
  assert.equal(report.netSales, 230)
  assert.equal(report.estimatedCogs, 140)
  assert.equal(report.estimatedGrossProfit, 90)
  assert.equal(report.bestSellingProducts[0]?.productId, 'widget')
  assert.equal(report.highestRevenueProducts[0]?.productId, 'widget')
})

test('CSV generators escape quotes, commas, and newlines and preserve financial columns', () => {
  assert.equal(escapeCsvField('Rent, "main"\nFloor'), '"Rent, ""main""\nFloor"')
  const data = source()
  data.expenses[0].description = 'Rent, "main"\nFloor'
  data.products[0].name = 'Widget, large'
  const sales = salesCsv(data.sales)
  const expenses = expensesCsv(data.expenses)
  const products = productsCsv(data.products)
  assert.match(sales, /sale ID,date,customer,payment method,subtotal,discount,total,cost,gross profit/)
  assert.match(sales, /200\.00,20\.00,180\.00,120\.00,60\.00/)
  assert.match(expenses, /"Rent, ""main""\nFloor"/)
  assert.match(products, /"Widget, large"/)
})
