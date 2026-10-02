import type { Product } from '../models/product'
import type { Sale } from '../models/sale'
import type { DashboardAnalytics } from '../services/reports'

export type DashboardPublicProduct = Omit<Product, 'costPrice'>
export type DashboardPublicSale = Omit<Sale, 'grossProfit' | 'totalCost' | 'items'> & {
  items: Array<Omit<Sale['items'][number], 'costPrice'>>
}

function timestampMillis(value: unknown) {
  if (typeof value === 'number') return value
  if (value instanceof Date) return value.getTime()
  const timestamp = value as { toMillis?: () => number } | null | undefined
  return typeof timestamp?.toMillis === 'function' ? timestamp.toMillis() : Number.NaN
}

function johannesburgDateKey(value: number | Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(value))
}

export function summarizeCashierDashboard(
  sales: DashboardPublicSale[],
  products: DashboardPublicProduct[],
  totalCustomers: number,
  now = new Date()
): DashboardAnalytics {
  const todayKey = johannesburgDateKey(now)
  const monthKey = todayKey.slice(0, 7)
  const todaySales = sales.filter((sale) => {
    const createdAt = timestampMillis(sale.createdAt)
    return Number.isFinite(createdAt) && johannesburgDateKey(createdAt) === todayKey
  })
  const productUnits = new Map<string, { name: string; units: number }>()
  for (const sale of sales) {
    const createdAt = timestampMillis(sale.createdAt)
    if (!Number.isFinite(createdAt) || !johannesburgDateKey(createdAt).startsWith(monthKey)) continue
    for (const item of sale.items) {
      const current = productUnits.get(item.productId) ?? { name: item.productName, units: 0 }
      current.units += Number(item.quantity ?? 0)
      productUnits.set(item.productId, current)
    }
  }
  const stockTracked = products.filter((product) => product.status === 'active' && product.trackStock)
  const recentSales = sales.slice(0, 5).map((sale) => ({
    ...sale,
    grossProfit: 0,
    items: sale.items.map((item) => ({ ...item, costPrice: 0 }))
  })) as Sale[]
  const bestSeller = [...productUnits.values()].sort((left, right) => right.units - left.units)[0]?.name ?? null

  return {
    todaysSales: todaySales.reduce((sum, sale) => sum + Number(sale.total ?? 0), 0),
    monthSales: 0,
    estimatedProfit: 0,
    expenses: 0,
    todayTransactions: todaySales.length,
    todayUnitsSold: todaySales.reduce((sum, sale) => sum + Number(sale.itemCount ?? 0), 0),
    lowStockCount: stockTracked.filter((product) => product.quantity > 0 && product.quantity <= product.reorderLevel).length,
    outOfStockCount: stockTracked.filter((product) => product.quantity <= 0).length,
    recentSales,
    bestSeller,
    totalCustomers
  }
}
