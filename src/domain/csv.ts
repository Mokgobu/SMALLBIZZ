import { getProductStockStatus } from './commerce'
import { timestampMillis } from './reports'
import type { Expense } from '../models/expense'
import type { Product } from '../models/product'
import type { Sale } from '../models/sale'

export function escapeCsvField(value: unknown): string {
  const text = value == null ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function csv(rows: unknown[][]) {
  return rows.map((row) => row.map(escapeCsvField).join(',')).join('\r\n')
}

function isoDate(value: unknown) {
  const millis = timestampMillis(value)
  return millis ? new Date(millis).toISOString() : ''
}

function amount(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00'
}

export function salesCsv(sales: Sale[]) {
  return csv([
    ['sale ID', 'date', 'customer', 'payment method', 'subtotal', 'discount', 'total', 'cost', 'gross profit'],
    ...sales.map((sale) => {
      const cost = sale.items.reduce((total, item) => total + item.costPrice * item.quantity, 0)
      return [sale.id, isoDate(sale.createdAt), sale.customerNameSnapshot ?? 'Walk-in', sale.paymentMethod, amount(sale.subtotal), amount(sale.discount), amount(sale.total), amount(cost), amount(sale.total - cost)]
    })
  ])
}

export function expensesCsv(expenses: Expense[]) {
  return csv([
    ['expense ID', 'date', 'category', 'description', 'supplier', 'payment method', 'amount'],
    ...expenses.map((expense) => [expense.id, isoDate(expense.expenseDate), expense.category, expense.description, expense.supplierNameSnapshot ?? '', expense.paymentMethod, amount(expense.amount)])
  ])
}

export function productsCsv(products: Product[]) {
  return csv([
    ['product ID', 'name', 'SKU', 'barcode', 'category', 'selling price', 'cost price', 'quantity', 'reorder level', 'stock status'],
    ...products.map((product) => [product.id, product.name, product.sku, product.barcode, product.category, amount(product.sellingPrice), amount(product.costPrice), product.quantity, product.reorderLevel, getProductStockStatus(product)])
  ])
}
