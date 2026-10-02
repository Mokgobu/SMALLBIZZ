export type BusinessAccountStatus = 'TRIAL' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED'

export type BusinessProfile = {
  id: string
  name: string
  type: string
  ownerUid: string
  memberUids: string[]
  accountStatus: BusinessAccountStatus
  planId: string
  currency: string
  phone: string
  email: string
  address: string
  website: string
  registrationNumber: string
  vatRegistered: boolean
  vatNumber: string | null
  invoicePrefix: string
  onboardingComplete: boolean
  trialStartedAt?: unknown
  trialEndsAt?: unknown
  createdAt?: unknown
  updatedAt?: unknown
}

export type OnboardingDetails = {
  businessName: string
  businessType: string
  phone: string
  email: string
  address: string
  website: string
  registrationNumber: string
  vatRegistered: boolean
  vatNumber: string
  currency: string
  invoicePrefix: string
  acceptedTerms: boolean
}
