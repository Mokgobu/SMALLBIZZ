import assert from 'node:assert/strict'
import test from 'node:test'
import { PERMISSIONS, hasPermission, permissionsForMembership, permissionsForRole } from '../src/auth/permissions'
import type { StaffRole, StaffStatus } from '../src/models/staff'

test('owner receives every business permission', () => {
  assert.deepEqual(permissionsForRole('owner'), PERMISSIONS)
})

test('manager can operate the business but cannot manage staff or ownership settings', () => {
  const permissions = permissionsForRole('manager')
  assert.ok(permissions.includes('view_reports'))
  assert.ok(permissions.includes('manage_expenses'))
  assert.ok(permissions.includes('manage_recipes'))
  assert.ok(permissions.includes('manage_kitchen_orders'))
  assert.equal(permissions.includes('manage_staff'), false)
  assert.equal(permissions.includes('manage_business_settings'), false)
})

test('supervisor can run floor operations and sanitized operational reports without financial access', () => {
  const permissions = permissionsForRole('supervisor')
  for (const allowed of ['create_sale', 'adjust_inventory', 'manage_customers', 'view_operational_reports'] as const) {
    assert.ok(permissions.includes(allowed))
  }
  for (const denied of ['manage_products', 'manage_staff', 'view_expenses', 'view_suppliers', 'view_reports'] as const) {
    assert.equal(permissions.includes(denied), false)
  }
  assert.ok(permissions.includes('manage_recipes'))
  assert.ok(permissions.includes('manage_kitchen_orders'))
})

test('cashier can sell and view catalog/customers but cannot change sensitive data', () => {
  const permissions = permissionsForRole('cashier')
  assert.ok(permissions.includes('create_sale'))
  assert.ok(permissions.includes('view_products'))
  assert.ok(permissions.includes('view_customers'))
  assert.ok(permissions.includes('view_kitchen'))
  assert.equal(permissions.includes('manage_recipes'), false)
  assert.equal(permissions.includes('manage_kitchen_orders'), false)
  for (const denied of ['manage_products', 'adjust_inventory', 'manage_customers', 'view_expenses', 'view_suppliers', 'view_reports', 'manage_staff'] as const) {
    assert.equal(permissions.includes(denied), false)
  }
})

test('non-active memberships receive no permissions', () => {
  for (const status of ['invited', 'suspended', 'disabled'] satisfies StaffStatus[]) {
    assert.deepEqual(permissionsForMembership({ role: 'owner', status }), [])
    assert.equal(hasPermission({ role: 'owner', status }, 'manage_staff'), false)
  }
  for (const role of ['owner', 'manager', 'supervisor', 'cashier'] satisfies StaffRole[]) {
    assert.ok(permissionsForMembership({ role, status: 'active' }).length > 0)
  }
})
