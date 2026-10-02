import { httpsCallable } from 'firebase/functions'
import { requireFirebase } from '../config/firebase'
import type { ManualInventoryMovementType } from '../models/inventory'
import type { Product } from '../models/product'
import type { ProductInput, ProductStatus } from '../models/product'
import type { RecordSaleInput, Sale } from '../models/sale'
import type { SalesRepository } from './sales'
import type { PageResult } from './tenant'

type PublicProduct = Omit<Product, 'costPrice'>
export type OperationalReport = {
  salesTotal: number
  transactionCount: number
  unitsSold: number
  salesTrend: Array<{ date: string; salesTotal: number; transactions: number }>
  productMovement: Array<{ productId: string; productName: string; movementCount: number; netQuantityChange: number }>
  lowStock: PublicProduct[]
  recentAdjustments: Array<{ id: string; productName: string; type: string; quantityChange: number; reason: string; createdAt: number | null }>
  activeCustomerCount: number
  recentSales: Array<Omit<Sale, 'grossProfit' | 'totalCost' | 'items'> & { items: Array<Omit<Sale['items'][number], 'costPrice'>> }>
}

export function createOperationalProductRepository() {
  const { functions } = requireFirebase()
  const listProducts = httpsCallable<Record<string, never>, { products: PublicProduct[] }>(functions, 'listOperationalProducts')
  const load = async () => (await listProducts({})).data.products.map((product) => ({ ...product, costPrice: 0 } as Product))
  const denied = async (_first?: string | ProductInput, _second?: ProductInput | ProductStatus) => { throw new Error('Your role cannot change product details.') }
  return {
    async listPage(): Promise<PageResult<Product>> { return { items: await load(), cursor: null, hasMore: false } },
    subscribe(onData: (products: Product[]) => void, onError: (error: unknown) => void) {
      void load().then(onData).catch(onError)
      return () => undefined
    },
    create: async (input: ProductInput) => { await denied(input); return '' },
    update: async (id: string, input: ProductInput) => { await denied(id, input) },
    setStatus: async (id: string, status: ProductStatus) => { await denied(id, status) }
  }
}

export function createOperationalSalesRepository(record: (input: RecordSaleInput) => Promise<import('../models/sale').CreateSaleResult>): SalesRepository {
  const { functions } = requireFirebase()
  type PublicSale = Omit<Sale, 'grossProfit' | 'totalCost' | 'items'> & { items: Array<Omit<Sale['items'][number], 'costPrice'>> }
  const listSales = httpsCallable<Record<string, never>, { sales: PublicSale[] }>(functions, 'listOperationalSales')
  const load = async () => (await listSales({})).data.sales.map((sale) => ({
    ...sale, grossProfit: 0, items: sale.items.map((item) => ({ ...item, costPrice: 0 }))
  } as Sale))
  return {
    async listPage() { return { items: await load(), cursor: null, hasMore: false } },
    subscribe(onData, onError) { void load().then(onData).catch(onError); return () => undefined },
    subscribeByCustomer(customerId, onData, onError) {
      void load().then((sales) => onData(sales.filter((sale) => sale.customerId === customerId))).catch(onError)
      return () => undefined
    },
    record
  }
}

export function createOperationalInventoryService() {
  const { functions } = requireFirebase()
  const adjust = httpsCallable<{ productId: string; type: ManualInventoryMovementType; quantity: number; reason: string }, { quantityAfter: number }>(functions, 'adjustOperationalInventory')
  return { adjustStock: async (input: { productId: string; type: ManualInventoryMovementType; quantity: number; reason: string }) => (await adjust(input)).data }
}

export function createOperationalReportsService() {
  const { functions } = requireFirebase()
  const report = httpsCallable<{ from: number; to: number }, OperationalReport>(functions, 'getOperationalReport')
  return { load: async (from: Date, to: Date) => (await report({ from: from.getTime(), to: to.getTime() })).data }
}
