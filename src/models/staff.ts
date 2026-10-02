export const STAFF_ROLES = ['owner', 'manager', 'supervisor', 'cashier'] as const
export type StaffRole = (typeof STAFF_ROLES)[number]

export const STAFF_STATUSES = ['invited', 'active', 'suspended', 'disabled'] as const
export type StaffStatus = (typeof STAFF_STATUSES)[number]

export type BusinessMembership = {
  id: string
  uid: string
  displayName: string
  email: string
  role: StaffRole
  status: StaffStatus
  invitedBy: string | null
  createdAt?: unknown
  updatedAt?: unknown
  joinedAt?: unknown
  lastActiveAt?: unknown
}

export type InviteStaffInput = {
  name: string
  email: string
  role: Exclude<StaffRole, 'owner'>
}

export type InviteStaffResult = {
  invitationId: string
  status: 'sent' | 'delivery_failed'
  /** Present only when running against the local Functions emulator. */
  testingInvitationUrl?: string
  /** Present only when running against the local Functions emulator. */
  testingPasswordSetupUrl?: string
}

export type StaffInvitation = {
  id: string
  invitedEmail: string
  displayName: string
  proposedRole: Exclude<StaffRole, 'owner'>
  status: 'pending' | 'sent' | 'delivery_failed' | 'accepted' | 'declined' | 'expired'
  createdAt?: unknown
  updatedAt?: unknown
  expiresAt?: unknown
  resendCount?: number
  deliveryAttempts?: number
  lastDeliveryAt?: unknown
}

export type StaffActivity = {
  id: string
  type: string
  actorUid?: string
  targetUid?: string
  actorName?: string
  targetName?: string
  description?: string
  previousRole?: string
  role?: string
  previousStatus?: string
  status?: string
  previousValue?: unknown
  newValue?: unknown
  createdAt?: unknown
}
