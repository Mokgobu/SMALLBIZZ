import { EXPENSE_CATEGORIES, type ExpenseInput } from '../models/expense'
import type { Customer, CustomerInput, CustomerSalesSummary } from '../models/customer'
import { PAYMENT_METHODS, type Sale } from '../models/sale'
import type { SupplierInput } from '../models/supplier'
import { ValidationError } from './commerce'

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validDateString(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
}

export function validateExpenseInput(input: ExpenseInput): ExpenseInput {
  const description = input.description.trim()
  if (!description) throw new ValidationError('Expense description is required.')
  if (!EXPENSE_CATEGORIES.includes(input.category)) throw new ValidationError('Choose a valid expense category.')
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new ValidationError('Expense amount must be greater than zero.')
  if (!validDateString(input.expenseDate)) throw new ValidationError('Choose a valid expense date.')
  if (!PAYMENT_METHODS.includes(input.paymentMethod)) throw new ValidationError('Choose a valid payment method.')
  return {
    description,
    category: input.category,
    amount: Math.round(input.amount * 100) / 100,
    expenseDate: input.expenseDate,
    paymentMethod: input.paymentMethod,
    supplierId: input.supplierId || null,
    reference: input.reference.trim(),
    notes: input.notes.trim()
  }
}

export function validateCustomerInput(input: CustomerInput) {
  const firstName = input.firstName.trim()
  const lastName = input.lastName.trim()
  if (!firstName && !lastName) throw new ValidationError('Enter at least a first name or last name.')
  const email = input.email.trim().toLowerCase()
  if (email && !emailPattern.test(email)) throw new ValidationError('Enter a valid customer email address.')
  if (input.birthday && !validDateString(input.birthday)) throw new ValidationError('Choose a valid birthday.')
  return {
    firstName,
    lastName,
    displayName: [firstName, lastName].filter(Boolean).join(' '),
    phone: input.phone.trim(),
    email,
    birthday: input.birthday || null,
    notes: input.notes.trim()
  }
}

export function validateSupplierInput(input: SupplierInput): SupplierInput {
  const name = input.name.trim()
  if (!name) throw new ValidationError('Supplier name is required.')
  const email = input.email.trim().toLowerCase()
  if (email && !emailPattern.test(email)) throw new ValidationError('Enter a valid supplier email address.')
  return {
    name,
    contactPerson: input.contactPerson.trim(),
    phone: input.phone.trim(),
    email,
    address: input.address.trim(),
    notes: input.notes.trim()
  }
}

function timestampMillis(value: unknown) {
  if (!value) return 0
  const timestamp = value as { toMillis?: () => number }
  if (typeof timestamp.toMillis === 'function') return timestamp.toMillis()
  const millis = new Date(value as string | number | Date).getTime()
  return Number.isNaN(millis) ? 0 : millis
}

export function aggregateCustomerSales(sales: Sale[]): CustomerSalesSummary {
  if (sales.length === 0) return { totalSpend: 0, transactionCount: 0, lastPurchaseAt: null }
  let totalCents = 0
  let latest: Sale | null = null
  for (const sale of sales) {
    totalCents += Math.round((Number.isFinite(sale.total) ? sale.total : 0) * 100)
    if (!latest || timestampMillis(sale.createdAt) > timestampMillis(latest.createdAt)) latest = sale
  }
  return {
    totalSpend: totalCents / 100,
    transactionCount: sales.length,
    lastPurchaseAt: latest?.createdAt ?? null
  }
}

export function customerMatchesSearch(customer: Customer, search: string) {
  const term = search.trim().toLowerCase()
  return !term || [customer.displayName, customer.email, customer.phone].some((value) => value.toLowerCase().includes(term))
}
