import type { Permission } from '../auth/permissions'

export type DashboardDataSource = 'financial' | 'operational' | 'cashier'
export type DashboardMetric =
  | 'todaySales'
  | 'monthSales'
  | 'expenses'
  | 'profit'
  | 'transactions'
  | 'unitsSold'
  | 'lowStock'
  | 'outOfStock'
  | 'customers'

export type DashboardAction = {
  to: string
  label: string
  description: string
  permission: Permission
}

const ACTIONS: readonly DashboardAction[] = [
  { to: '/sales', label: 'New sale', description: 'Open the point of sale.', permission: 'create_sale' },
  { to: '/products', label: 'Products', description: 'Review the current catalogue.', permission: 'view_products' },
  { to: '/inventory', label: 'Inventory', description: 'Receive and adjust stock.', permission: 'view_inventory' },
  { to: '/expiry', label: 'Expiry', description: 'Review batches needing attention.', permission: 'view_expiry' },
  { to: '/promotions', label: 'Promotions', description: 'Review active offers.', permission: 'view_promotions' },
  { to: '/customers', label: 'Customers', description: 'Find customer records.', permission: 'view_customers' }
]

function includes(permissions: readonly Permission[], permission: Permission) {
  return permissions.includes(permission)
}

export function dashboardPolicy(permissions: readonly Permission[]) {
  const source: DashboardDataSource = includes(permissions, 'view_reports')
    ? 'financial'
    : includes(permissions, 'view_operational_reports')
      ? 'operational'
      : 'cashier'

  const metrics: DashboardMetric[] = source === 'financial'
    ? ['todaySales', 'monthSales', 'expenses', 'profit', 'lowStock', 'outOfStock', 'customers']
    : source === 'operational'
      ? ['todaySales', 'monthSales', 'lowStock', 'outOfStock', 'customers']
      : ['todaySales', 'transactions', 'unitsSold', 'lowStock', 'outOfStock', 'customers']

  return {
    source,
    metrics,
    actions: ACTIONS.filter((action) => includes(permissions, action.permission))
  }
}
