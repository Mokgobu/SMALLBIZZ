import assert from 'node:assert/strict'
import test from 'node:test'
import { assertTargetCanChange, validateRoleUpdate, validateStaffInvite, validateStatusUpdate } from './staffDomain.js'

test('staff invite normalizes safe inputs and rejects owner or extra fields', () => {
  assert.deepEqual(validateStaffInvite({ name: ' Neo ', email: 'NEO@EXAMPLE.COM', role: 'cashier' }), { name: 'Neo', email: 'neo@example.com', role: 'cashier' })
  assert.throws(() => validateStaffInvite({ name: 'Neo', email: 'neo@example.com', role: 'owner' }), /manager, supervisor, or cashier/)
  assert.throws(() => validateStaffInvite({ name: 'Neo', email: 'neo@example.com', role: 'cashier', businessId: 'other' }), /unsupported/)
})

test('role updates cannot assign owner and status updates are bounded', () => {
  assert.deepEqual(validateRoleUpdate({ uid: 'staff-a', role: 'manager' }), { uid: 'staff-a', role: 'manager' })
  assert.throws(() => validateRoleUpdate({ uid: 'staff-a', role: 'owner' }), /ownership-transfer/i)
  assert.deepEqual(validateStatusUpdate({ uid: 'staff-a', status: 'suspended' }), { uid: 'staff-a', status: 'suspended' })
  assert.throws(() => validateStatusUpdate({ uid: 'staff-a', status: 'invited' }), /active, suspended, or disabled/)
})

test('owner self-access and target owner membership are protected', () => {
  assert.throws(() => assertTargetCanChange('owner', 'owner', 'owner'), /own authoritative/)
  assert.throws(() => assertTargetCanChange('owner', 'other-owner', 'owner'), /protected/)
  assert.doesNotThrow(() => assertTargetCanChange('owner', 'cashier', 'cashier'))
})
