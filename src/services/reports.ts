import {
  documentId,
  getCountFromServer,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  Timestamp,
  where,
  type DocumentData,
  type Query,
  type QueryDocumentSnapshot
} from 'firebase/firestore'
import { calculateReport, resolveReportDateRange, type ReportDateRange, type ReportSourceData, type ReportSummary } from '../domain/reports'
import type { Expense } from '../models/expense'
import type { InventoryMovement } from '../models/inventory'
import type { Product } from '../models/product'
import type { Sale } from '../models/sale'
import { tenantCollection } from './tenant'

const REPORT_BATCH_SIZE = 250

async function readAll<T extends { id: string }>(baseQuery: Query<DocumentData>): Promise<T[]> {
  const records: T[] = []
  let cursor: QueryDocumentSnapshot<DocumentData> | null = null
  do {
    const pageQuery: Query<DocumentData> = cursor
      ? query(baseQuery, startAfter(cursor), limit(REPORT_BATCH_SIZE))
      : query(baseQuery, limit(REPORT_BATCH_SIZE))
    const snapshot = await getDocs(pageQuery)
    records.push(...snapshot.docs.map((item: QueryDocumentSnapshot<DocumentData>) => ({ id: item.id, ...item.data() }) as T))
    cursor = snapshot.docs.length === REPORT_BATCH_SIZE ? snapshot.docs[snapshot.docs.length - 1] : null
  } while (cursor)
  return records
}

export type LoadedReport = {
  range: ReportDateRange
  source: ReportSourceData
  summary: ReportSummary
}

export type DashboardAnalytics = {
  todaysSales: number
  monthSales: number
  estimatedProfit: number
  expenses: number
  todayTransactions: number
  todayUnitsSold: number
  lowStockCount: number
  outOfStockCount: number
  recentSales: Sale[]
  bestSeller: string | null
  totalCustomers: number
}

export type ReportsService = {
  load: (range: ReportDateRange) => Promise<LoadedReport>
  loadDashboard: (now?: Date, includeFinancials?: boolean) => Promise<DashboardAnalytics>
}

export function createFirestoreReportsService(businessId: string, userId: string): ReportsService {
  const sales = tenantCollection(businessId, userId, 'sales').collectionRef
  const expenses = tenantCollection(businessId, userId, 'expenses').collectionRef
  const products = tenantCollection(businessId, userId, 'products').collectionRef
  const customers = tenantCollection(businessId, userId, 'customers').collectionRef
  const movements = tenantCollection(businessId, userId, 'inventoryMovements').collectionRef

  const load = async (range: ReportDateRange): Promise<LoadedReport> => {
    const start = Timestamp.fromDate(range.start)
    const end = Timestamp.fromDate(range.end)
    const [reportSales, reportExpenses, reportProducts, customerCount, inventoryMovements] = await Promise.all([
      readAll<Sale>(query(sales, where('createdAt', '>=', start), where('createdAt', '<', end), orderBy('createdAt'), orderBy(documentId()))),
      readAll<Expense>(query(expenses, where('expenseDate', '>=', start), where('expenseDate', '<', end), orderBy('expenseDate'), orderBy(documentId()))),
      readAll<Product>(query(products, orderBy('name'), orderBy(documentId()))),
      getCountFromServer(query(customers, where('status', '==', 'active'))),
      readAll<InventoryMovement>(query(movements, where('createdAt', '>=', start), where('createdAt', '<', end), orderBy('createdAt'), orderBy(documentId())))
    ])
    const source = { sales: reportSales, expenses: reportExpenses, products: reportProducts, customers: [], inventoryMovements, activeCustomerCount: customerCount.data().count }
    return { range, source, summary: calculateReport(source) }
  }

  return {
    load,
    async loadDashboard(now = new Date(), includeFinancials = true) {
      const monthRange = resolveReportDateRange('this_month', now)
      const todayRange = resolveReportDateRange('today', now)
      const start = Timestamp.fromDate(monthRange.start)
      const end = Timestamp.fromDate(monthRange.end)
      const [monthSales, monthExpenses, currentProducts, customerCount, recentSnapshot] = await Promise.all([
        readAll<Sale>(query(sales, where('createdAt', '>=', start), where('createdAt', '<', end), orderBy('createdAt'), orderBy(documentId()))),
        includeFinancials ? readAll<Expense>(query(expenses, where('expenseDate', '>=', start), where('expenseDate', '<', end), orderBy('expenseDate'), orderBy(documentId()))) : Promise.resolve([]),
        readAll<Product>(query(products, orderBy('name'), orderBy(documentId()))),
        getCountFromServer(query(customers, where('status', '==', 'active'))),
        getDocs(query(sales, orderBy('createdAt', 'desc'), orderBy(documentId(), 'desc'), limit(5)))
      ])
      const recentSales = recentSnapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as Sale)
      const source: ReportSourceData = { sales: monthSales, expenses: monthExpenses, products: currentProducts, customers: [], inventoryMovements: [] }
      const month = calculateReport(source)
      const today = calculateReport(source, todayRange)
      return {
        todaysSales: today.netSales,
        monthSales: month.netSales,
        estimatedProfit: month.estimatedOperatingProfit,
        expenses: month.expenses,
        todayTransactions: today.transactionCount,
        todayUnitsSold: today.unitsSold,
        lowStockCount: month.lowStockProducts.length,
        outOfStockCount: month.outOfStockProducts.length,
        recentSales: recentSales.slice(0, 5),
        bestSeller: month.bestSellingProducts[0]?.productName ?? null,
        totalCustomers: customerCount.data().count
      }
    }
  }
}
