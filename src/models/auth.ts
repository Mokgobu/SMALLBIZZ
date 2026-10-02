export type UserAccountStatus = 'ACTIVE' | 'SUSPENDED' | 'CANCELLED'

export type UserProfile = {
  id: string
  fullName: string
  email: string | null
  role: 'USER'
  accountStatus: UserAccountStatus
  businessId: string | null
  linkedBusinessId?: string | null
  onboardingComplete: boolean
  termsVersion: string | null
  termsAcceptedAt?: unknown
  createdAt?: unknown
  updatedAt?: unknown
}
