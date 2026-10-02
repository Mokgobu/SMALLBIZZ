import { collection, doc, serverTimestamp, Timestamp, writeBatch } from 'firebase/firestore'
import { requireFirebase } from '../config/firebase'
import type { OnboardingDetails } from '../models/business'

export const CURRENT_TERMS_VERSION = '2026-09-07'
const TRIAL_LENGTH_DAYS = 14

export async function completeBusinessOnboarding(
  userId: string,
  userEmail: string | null,
  userDisplayName: string | null,
  hasUserProfile: boolean,
  details: OnboardingDetails
) {
  if (!details.acceptedTerms) {
    throw new Error('Terms and Conditions must be accepted before continuing.')
  }

  const { db } = requireFirebase()
  const businessRef = doc(collection(db, 'businesses'))
  const userRef = doc(db, 'users', userId)
  const memberRef = doc(db, 'businesses', businessRef.id, 'members', userId)
  const batch = writeBatch(db)
  const trialEndsAt = Timestamp.fromMillis(
    Date.now() + TRIAL_LENGTH_DAYS * 24 * 60 * 60 * 1000
  )

  batch.set(businessRef, {
    name: details.businessName.trim(),
    type: details.businessType,
    ownerUid: userId,
    memberUids: [userId],
    accountStatus: 'TRIAL',
    planId: 'trial',
    trialStartedAt: serverTimestamp(),
    trialEndsAt,
    phone: details.phone.trim(),
    email: details.email.trim() || userEmail,
    address: details.address.trim(),
    website: details.website.trim(),
    registrationNumber: details.registrationNumber.trim(),
    vatRegistered: details.vatRegistered,
    vatNumber: details.vatRegistered ? details.vatNumber.trim() || null : null,
    currency: details.currency,
    invoicePrefix: details.invoicePrefix.trim(),
    onboardingComplete: true,
    termsVersion: CURRENT_TERMS_VERSION,
    termsAcceptedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  })

  const onboardingProfile = {
      businessId: businessRef.id,
      linkedBusinessId: businessRef.id,
      onboardingComplete: true,
      termsVersion: CURRENT_TERMS_VERSION,
      termsAcceptedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
  }

  batch.set(memberRef, {
    uid: userId,
    displayName: userDisplayName?.trim() || userEmail || 'Business owner',
    email: userEmail ?? '',
    role: 'owner',
    status: 'active',
    invitedBy: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    joinedAt: serverTimestamp(),
    lastActiveAt: serverTimestamp()
  })

  if (hasUserProfile) {
    batch.set(userRef, onboardingProfile, { merge: true })
  } else {
    batch.set(userRef, {
      ...onboardingProfile,
      fullName: userDisplayName?.trim() ?? '',
      email: userEmail,
      role: 'USER',
      accountStatus: 'ACTIVE',
      createdAt: serverTimestamp()
    })
  }

  await batch.commit()
  return businessRef.id
}
