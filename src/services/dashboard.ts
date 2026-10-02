import { getCountFromServer, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { requireFirebase } from '../config/firebase'
import { summarizeCashierDashboard, type DashboardPublicProduct, type DashboardPublicSale } from '../dashboard/cashierDashboard'
import { tenantCollection } from './tenant'

export function createCashierDashboardService(businessId: string, userId: string) {
  const { functions } = requireFirebase()
  const customers = tenantCollection(businessId, userId, 'customers').collectionRef
  const listSales = httpsCallable<Record<string, never>, { sales: DashboardPublicSale[] }>(functions, 'listOperationalSales')
  const listProducts = httpsCallable<Record<string, never>, { products: DashboardPublicProduct[] }>(functions, 'listOperationalProducts')

  return {
    async load(now = new Date()) {
      const [salesResult, productsResult, customerCount] = await Promise.all([
        listSales({}),
        listProducts({}),
        getCountFromServer(query(customers, where('status', '==', 'active')))
      ])
      return summarizeCashierDashboard(salesResult.data.sales, productsResult.data.products, customerCount.data().count, now)
    }
  }
}
