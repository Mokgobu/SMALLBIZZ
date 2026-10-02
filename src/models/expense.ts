import type { PaymentMethod } from './sale'

export const EXPENSE_CATEGORIES = [
  'inventory', 'rent', 'utilities', 'transport', 'marketing',
  'salaries', 'professional_services', 'taxes', 'other'
] as const
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

export type Expense = {
  id: string
  description: string
  category: ExpenseCategory
  amount: number
  expenseDate: unknown
  paymentMethod: PaymentMethod
  supplierId: string | null
  supplierNameSnapshot: string | null
  reference: string
  notes: string
  status: 'active' | 'archived'
  createdAt?: unknown
  updatedAt?: unknown
  createdBy: string
}

export type ExpenseInput = {
  description: string
  category: ExpenseCategory
  amount: number
  expenseDate: string
  paymentMethod: PaymentMethod
  supplierId: string | null
  reference: string
  notes: string
}
