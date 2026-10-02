export const STAFF_ROLES = ['owner', 'manager', 'supervisor', 'cashier'] as const
export type StaffRole = (typeof STAFF_ROLES)[number]
export const ASSIGNABLE_STAFF_ROLES = ['manager', 'supervisor', 'cashier'] as const
export type AssignableStaffRole = (typeof ASSIGNABLE_STAFF_ROLES)[number]
export const MUTABLE_STAFF_STATUSES = ['active', 'suspended', 'disabled'] as const
export type MutableStaffStatus = (typeof MUTABLE_STAFF_STATUSES)[number]

export type StaffInvite = { name: string; email: string; role: AssignableStaffRole }

function exactObject(value: unknown, keys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A valid request is required.')
  const actual = Object.keys(value as Record<string, unknown>)
  if (actual.some((key) => !keys.includes(key))) throw new Error('The request contains unsupported fields.')
  return value as Record<string, unknown>
}

export function validateStaffInvite(value: unknown): StaffInvite {
  const data = exactObject(value, ['name', 'email', 'role'])
  const name = typeof data.name === 'string' ? data.name.trim() : ''
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : ''
  if (!name || name.length > 100) throw new Error('Enter a staff name of 1 to 100 characters.')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Enter a valid staff email address.')
  if (!ASSIGNABLE_STAFF_ROLES.includes(data.role as AssignableStaffRole)) throw new Error('Choose manager, supervisor, or cashier.')
  return { name, email, role: data.role as AssignableStaffRole }
}

export function validateRoleUpdate(value: unknown) {
  const data = exactObject(value, ['uid', 'role'])
  const uid = typeof data.uid === 'string' ? data.uid.trim() : ''
  if (!uid) throw new Error('A staff account is required.')
  if (!ASSIGNABLE_STAFF_ROLES.includes(data.role as AssignableStaffRole)) throw new Error('Owner cannot be assigned without an ownership-transfer flow.')
  return { uid, role: data.role as AssignableStaffRole }
}

export function validateStatusUpdate(value: unknown) {
  const data = exactObject(value, ['uid', 'status'])
  const uid = typeof data.uid === 'string' ? data.uid.trim() : ''
  if (!uid) throw new Error('A staff account is required.')
  if (!MUTABLE_STAFF_STATUSES.includes(data.status as MutableStaffStatus)) throw new Error('Choose active, suspended, or disabled.')
  return { uid, status: data.status as MutableStaffStatus }
}

export function assertTargetCanChange(callerUid: string, targetUid: string, targetRole: unknown) {
  if (callerUid === targetUid) throw new Error('You cannot change your own authoritative staff access.')
  if (targetRole === 'owner') throw new Error('The owner is protected. Ownership transfer is not available.')
}
