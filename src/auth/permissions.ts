import type { BusinessMembership, StaffRole, StaffStatus } from '../models/staff'

export const PERMISSIONS = [
  'view_dashboard',
  'create_sale',
  'view_sales',
  'refund_sale',
  'view_products',
  'manage_products',
  'view_inventory',
  'adjust_inventory',
  'view_customers',
  'manage_customers',
  'view_expenses',
  'manage_expenses',
  'view_suppliers',
  'manage_suppliers',
  'view_reports',
  'view_operational_reports',
  'view_expiry',
  'manage_expiry',
  'view_promotions',
  'manage_promotions',
  'apply_manual_discount',
  'receive_stock',
  'write_off_stock',
  'perform_stock_count',
  'manage_recipes',
  'view_kitchen',
  'manage_kitchen_orders',
  'manage_staff',
  'manage_business_settings'
] as const

export type Permission = (typeof PERMISSIONS)[number]

const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  owner: PERMISSIONS,
  manager: [
    'view_dashboard', 'create_sale', 'view_sales', 'refund_sale',
    'view_products', 'manage_products', 'view_inventory', 'adjust_inventory',
    'view_customers', 'manage_customers', 'view_expenses', 'manage_expenses',
    'view_suppliers', 'manage_suppliers', 'view_reports', 'view_operational_reports',
    'view_expiry', 'manage_expiry', 'view_promotions', 'manage_promotions', 'apply_manual_discount',
    'receive_stock', 'write_off_stock', 'perform_stock_count',
    'manage_recipes', 'view_kitchen', 'manage_kitchen_orders'
  ],
  supervisor: [
    'view_dashboard', 'create_sale', 'view_sales', 'view_products',
    'view_inventory', 'adjust_inventory', 'view_customers', 'manage_customers',
    'view_operational_reports', 'view_expiry', 'manage_expiry', 'view_promotions',
    'apply_manual_discount', 'receive_stock', 'write_off_stock', 'perform_stock_count',
    'manage_recipes', 'view_kitchen', 'manage_kitchen_orders'
  ],
  cashier: [
    'view_dashboard', 'create_sale', 'view_sales', 'view_products', 'view_customers', 'view_promotions', 'view_kitchen'
  ]
}

export function permissionsForRole(role: StaffRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role]
}

export function permissionsForMembership(
  membership: Pick<BusinessMembership, 'role' | 'status'> | null
): readonly Permission[] {
  return membership?.status === 'active' ? permissionsForRole(membership.role) : []
}

export function hasPermission(
  membership: Pick<BusinessMembership, 'role' | 'status'> | null,
  permission: Permission
) {
  return permissionsForMembership(membership).includes(permission)
}

export function isAccessBlocked(status: StaffStatus | undefined) {
  return status === 'suspended' || status === 'disabled' || status === 'invited'
}
