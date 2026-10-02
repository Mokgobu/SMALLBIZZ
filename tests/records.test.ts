import assert from 'node:assert/strict'
import test from 'node:test'
import { aggregateCustomerSales, validateCustomerInput, validateExpenseInput, validateSupplierInput } from '../src/domain/records'
import type { Sale } from '../src/models/sale'

test('expense validation requires positive amount, category, date, and payment method', () => {
  const valid = validateExpenseInput({ description: ' Internet ', category: 'utilities', amount: 499.999, expenseDate: '2026-09-07', paymentMethod: 'eft', supplierId: null, reference: '', notes: '' })
  assert.equal(valid.description, 'Internet')
  assert.equal(valid.amount, 500)
  assert.throws(() => validateExpenseInput({ ...valid, amount: 0 }), /greater than zero/)
  assert.throws(() => validateExpenseInput({ ...valid, expenseDate: 'not-a-date' }), /valid expense date/)
  assert.throws(() => validateExpenseInput({ ...valid, expenseDate: '2026-02-31' }), /valid expense date/)
})

test('customer validation creates a normalized display name', () => {
  const customer = validateCustomerInput({ firstName: ' Ada ', lastName: ' Lovelace ', email: 'ADA@EXAMPLE.COM', phone: ' 123 ', birthday: null, notes: '' })
  assert.equal(customer.displayName, 'Ada Lovelace')
  assert.equal(customer.email, 'ada@example.com')
  assert.throws(() => validateCustomerInput({ ...customer, birthday: '2026-02-31' }), /valid birthday/)
  assert.throws(() => validateCustomerInput({ firstName: '', lastName: '', email: '', phone: '', birthday: null, notes: '' }), /at least a first name or last name/)
})

test('supplier validation requires a name and validates optional email', () => {
  const supplier = validateSupplierInput({ name: ' Acme ', contactPerson: '', phone: '', email: 'SALES@ACME.TEST', address: '', notes: '' })
  assert.equal(supplier.name, 'Acme')
  assert.equal(supplier.email, 'sales@acme.test')
  assert.throws(() => validateSupplierInput({ ...supplier, name: '' }), /Supplier name is required/)
})

test('customer sales aggregation calculates spend, count, and latest purchase', () => {
  const makeSale = (id: string, total: number, millis: number): Sale => ({
    id, items: [], itemCount: 1, subtotal: total, discount: 0, total, grossProfit: 0,
    paymentMethod: 'cash', notes: '', customerId: 'customer-a', customerNameSnapshot: 'Ada',
    createdAt: { toMillis: () => millis }, createdBy: 'user-a'
  })
  const first = makeSale('sale-1', 100.10, 1000)
  const latest = makeSale('sale-2', 49.90, 2000)
  const summary = aggregateCustomerSales([first, latest])
  assert.equal(summary.totalSpend, 150)
  assert.equal(summary.transactionCount, 2)
  assert.equal(summary.lastPurchaseAt, latest.createdAt)
})
