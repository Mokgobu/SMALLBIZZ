import { getProductStockStatus } from './commerce'
import type { Customer } from '../models/customer'
import type { Expense, ExpenseCategory } from '../models/expense'
import type { InventoryMovement } from '../models/inventory'
import { isRecipeIngredientConsumption } from './inventoryMovements'
import type { Product } from '../models/product'
import type { PaymentMethod, Sale } from '../models/sale'

export type ReportDatePreset = 'today' | 'last_7_days' | 'this_month' | 'last_month' | 'custom'

export type ReportDateRange = {
  start: Date
  end: Date
  label: string
}

export type ReportSourceData = {
  sales: Sale[]
  expenses: Expense[]
  products: Product[]
  customers: Customer[]
  inventoryMovements: InventoryMovement[]
  activeCustomerCount?: number
}

export type ProductPerformance = {
  productId: string
  productName: string
  unitsSold: number
  revenue: number
}

export type CustomerPerformance = {
  customerId: string
  customerName: string
  transactionCount: number
  totalSpend: number
}

export type PaymentBreakdown = {
  paymentMethod: PaymentMethod
  transactionCount: number
  netSales: number
}

export type ExpenseCategoryBreakdown = {
  category: ExpenseCategory
  amount: number
}

export type ReportSummary = {
  grossSales: number
  discounts: number
  netSales: number
  estimatedCogs: number
  estimatedGrossProfit: number
  expenses: number
  estimatedOperatingProfit: number
  transactionCount: number
  averageSaleValue: number
  unitsSold: number
  activeCustomerCount: number
  inventoryMovementCount: number
  bestSellingProducts: ProductPerformance[]
  highestRevenueProducts: ProductPerformance[]
  lowStockProducts: Product[]
  outOfStockProducts: Product[]
  topCustomers: CustomerPerformance[]
  expensesByCategory: ExpenseCategoryBreakdown[]
  payments: PaymentBreakdown[]
  restaurant: {
    menuUnitsSold: number
    menuRevenue: number
    estimatedRecipeCost: number
    estimatedFoodMargin: number
    topMenuItems: ProductPerformance[]
    ingredientUsage: Array<{ productId: string; productName: string; quantity: number; unit: string }>
    wasteQuantity: number
  }
}

export function timestampMillis(value: unknown): number {
  if (!value) return 0
  const timestamp = value as { toMillis?: () => number; toDate?: () => Date }
  if (typeof timestamp.toMillis === 'function') return timestamp.toMillis()
  if (typeof timestamp.toDate === 'function') return timestamp.toDate().getTime()
  if (value instanceof Date) return value.getTime()
  const millis = new Date(value as string | number).getTime()
  return Number.isNaN(millis) ? 0 : millis
}

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate())
}

function addDays(value: Date, days: number) {
  const next = new Date(value)
  next.setDate(next.getDate() + days)
  return next
}

function localDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return date.getFullYear() === Number(match[1])
    && date.getMonth() === Number(match[2]) - 1
    && date.getDate() === Number(match[3]) ? date : null
}

export function resolveReportDateRange(
  preset: ReportDatePreset,
  now = new Date(),
  custom?: { from: string; to: string }
): ReportDateRange {
  const today = startOfDay(now)
  if (preset === 'today') return { start: today, end: addDays(today, 1), label: 'Today' }
  if (preset === 'last_7_days') return { start: addDays(today, -6), end: addDays(today, 1), label: 'Last 7 days' }
  if (preset === 'this_month') {
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 1),
      label: 'This month'
    }
  }
  if (preset === 'last_month') {
    return {
      start: new Date(now.getFullYear(), now.getMonth() - 1, 1),
      end: new Date(now.getFullYear(), now.getMonth(), 1),
      label: 'Last month'
    }
  }
  const start = custom ? localDate(custom.from) : null
  const inclusiveEnd = custom ? localDate(custom.to) : null
  if (!start || !inclusiveEnd || start > inclusiveEnd) throw new Error('Choose a valid custom date range.')
  return { start, end: addDays(inclusiveEnd, 1), label: `${custom?.from} to ${custom?.to}` }
}

export function filterReportDataByRange(data: ReportSourceData, range: ReportDateRange): ReportSourceData {
  const includes = (value: unknown) => {
    const millis = timestampMillis(value)
    return millis >= range.start.getTime() && millis < range.end.getTime()
  }
  return {
    ...data,
    sales: data.sales.filter((sale) => includes(sale.createdAt)),
    expenses: data.expenses.filter((expense) => includes(expense.expenseDate)),
    inventoryMovements: data.inventoryMovements.filter((movement) => includes(movement.createdAt))
  }
}

function moneyFromCents(cents: number) {
  return Math.round(cents) / 100
}

export function calculateReport(source: ReportSourceData, range?: ReportDateRange): ReportSummary {
  const data = range ? filterReportDataByRange(source, range) : source
  let grossSalesCents = 0
  let discountCents = 0
  let netSalesCents = 0
  let cogsCents = 0
  let unitsSold = 0
  let menuUnitsSold = 0, menuRevenueCents = 0, menuCostCents = 0
  const menuProducts = new Map<string, { productId: string; productName: string; unitsSold: number; revenueCents: number }>()
  const products = new Map<string, { productId: string; productName: string; unitsSold: number; revenueCents: number }>()
  const customers = new Map<string, { customerId: string; customerName: string; transactionCount: number; totalCents: number }>()
  const payments = new Map<PaymentMethod, { transactionCount: number; netCents: number }>()

  for (const sale of data.sales) {
    grossSalesCents += Math.round(sale.subtotal * 100)
    discountCents += Math.round(sale.discount * 100)
    netSalesCents += Math.round(sale.total * 100)
    for (const item of sale.items) {
      unitsSold += item.quantity
      cogsCents += Math.round(item.costPrice * item.quantity * 100)
      const key = item.productId || `${item.productName}:${item.sku}`
      const current = products.get(key) ?? { productId: item.productId, productName: item.productName, unitsSold: 0, revenueCents: 0 }
      current.unitsSold += item.quantity
      current.revenueCents += Math.round(item.lineTotal * 100)
      products.set(key, current)
      if (item.menuItem || item.recipeSnapshot) {
        menuUnitsSold += item.quantity
        menuRevenueCents += Math.round(item.lineTotal * 100)
        menuCostCents += Math.round(item.costPrice * item.quantity * 100)
        const menu = menuProducts.get(key) ?? { productId: item.productId, productName: item.productName, unitsSold: 0, revenueCents: 0 }
        menu.unitsSold += item.quantity; menu.revenueCents += Math.round(item.lineTotal * 100); menuProducts.set(key, menu)
      }
    }
    if (sale.customerId && sale.customerNameSnapshot) {
      const current = customers.get(sale.customerId) ?? {
        customerId: sale.customerId,
        customerName: sale.customerNameSnapshot,
        transactionCount: 0,
        totalCents: 0
      }
      current.transactionCount += 1
      current.totalCents += Math.round(sale.total * 100)
      customers.set(sale.customerId, current)
    }
    const payment = payments.get(sale.paymentMethod) ?? { transactionCount: 0, netCents: 0 }
    payment.transactionCount += 1
    payment.netCents += Math.round(sale.total * 100)
    payments.set(sale.paymentMethod, payment)
  }

  const activeExpenses = data.expenses.filter((expense) => expense.status !== 'archived')
  const expenseCategories = new Map<ExpenseCategory, number>()
  let expenseCents = 0
  for (const expense of activeExpenses) {
    const cents = Math.round(expense.amount * 100)
    expenseCents += cents
    expenseCategories.set(expense.category, (expenseCategories.get(expense.category) ?? 0) + cents)
  }

  const productPerformance = [...products.values()].map((item) => ({
    productId: item.productId,
    productName: item.productName,
    unitsSold: item.unitsSold,
    revenue: moneyFromCents(item.revenueCents)
  }))
  const currentTrackedProducts = data.products.filter((product) => product.status === 'active' && product.trackStock)
  const netSales = moneyFromCents(netSalesCents)
  const estimatedCogs = moneyFromCents(cogsCents)
  const expenses = moneyFromCents(expenseCents)
  const estimatedGrossProfit = moneyFromCents(netSalesCents - cogsCents)
  const ingredientUsage = new Map<string, { productId: string; productName: string; quantity: number; unit: string }>()
  let wasteQuantity = 0
  for (const movement of data.inventoryMovements) {
    if (isRecipeIngredientConsumption(movement)) { const current = ingredientUsage.get(movement.productId) ?? { productId: movement.productId, productName: movement.productName, quantity: 0, unit: movement.unit ?? '' }; current.quantity += Math.abs(movement.quantityChange); ingredientUsage.set(movement.productId, current) }
    if (['waste', 'expired', 'expiry_write_off', 'damaged', 'damaged_write_off'].includes(movement.type)) wasteQuantity += Math.abs(movement.quantityChange)
  }

  return {
    grossSales: moneyFromCents(grossSalesCents),
    discounts: moneyFromCents(discountCents),
    netSales,
    estimatedCogs,
    estimatedGrossProfit,
    expenses,
    estimatedOperatingProfit: moneyFromCents(netSalesCents - cogsCents - expenseCents),
    transactionCount: data.sales.length,
    averageSaleValue: data.sales.length ? moneyFromCents(netSalesCents / data.sales.length) : 0,
    unitsSold,
    activeCustomerCount: data.activeCustomerCount ?? data.customers.filter((customer) => customer.status === 'active').length,
    inventoryMovementCount: data.inventoryMovements.length,
    bestSellingProducts: [...productPerformance].sort((a, b) => b.unitsSold - a.unitsSold || b.revenue - a.revenue).slice(0, 10),
    highestRevenueProducts: [...productPerformance].sort((a, b) => b.revenue - a.revenue || b.unitsSold - a.unitsSold).slice(0, 10),
    lowStockProducts: currentTrackedProducts.filter((product) => getProductStockStatus(product) === 'low_stock').sort((a, b) => a.quantity - b.quantity),
    outOfStockProducts: currentTrackedProducts.filter((product) => getProductStockStatus(product) === 'out_of_stock').sort((a, b) => a.name.localeCompare(b.name)),
    topCustomers: [...customers.values()].map((customer) => ({
      customerId: customer.customerId,
      customerName: customer.customerName,
      transactionCount: customer.transactionCount,
      totalSpend: moneyFromCents(customer.totalCents)
    })).sort((a, b) => b.totalSpend - a.totalSpend).slice(0, 10),
    expensesByCategory: [...expenseCategories.entries()].map(([category, cents]) => ({ category, amount: moneyFromCents(cents) })).sort((a, b) => b.amount - a.amount),
    payments: [...payments.entries()].map(([paymentMethod, payment]) => ({
      paymentMethod,
      transactionCount: payment.transactionCount,
      netSales: moneyFromCents(payment.netCents)
    })).sort((a, b) => b.netSales - a.netSales),
    restaurant: {
      menuUnitsSold, menuRevenue: moneyFromCents(menuRevenueCents), estimatedRecipeCost: moneyFromCents(menuCostCents), estimatedFoodMargin: moneyFromCents(menuRevenueCents - menuCostCents),
      topMenuItems: [...menuProducts.values()].map((item) => ({ ...item, revenue: moneyFromCents(item.revenueCents) })).map(({ revenueCents: _ignored, ...item }) => item).sort((a, b) => b.unitsSold - a.unitsSold).slice(0, 10),
      ingredientUsage: [...ingredientUsage.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 10), wasteQuantity
    }
  }
}
