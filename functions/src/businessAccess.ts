import { Timestamp, getFirestore, type Firestore } from 'firebase-admin/firestore'
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https'

export type AuthContext = NonNullable<CallableRequest<unknown>['auth']>
export const BUSINESS_ROLES = ['owner', 'manager', 'supervisor', 'cashier'] as const
export type BusinessRole = typeof BUSINESS_ROLES[number]

export async function requireBusinessRole(auth: AuthContext | undefined, allowed: readonly BusinessRole[], db: Firestore = getFirestore(), now = Timestamp.now()) {
  if (!auth?.uid) throw new HttpsError('unauthenticated', 'Sign in to continue.')
  const profileRef = db.doc(`users/${auth.uid}`); const profile = await profileRef.get(); const profileData = profile.data() ?? {}
  if (!profile.exists || profileData.accountStatus !== 'ACTIVE') throw new HttpsError('permission-denied', 'Your account is not active.')
  const businessId = String(profileData.linkedBusinessId ?? profileData.businessId ?? '').trim()
  if (!businessId) throw new HttpsError('failed-precondition', 'Your account is not linked to a business.')
  const businessRef = db.doc(`businesses/${businessId}`)
  const [business, membership] = await Promise.all([businessRef.get(), businessRef.collection('members').doc(auth.uid).get()])
  if (!business.exists) throw new HttpsError('failed-precondition', 'The linked business is unavailable.')
  const businessData = business.data()!
  const activeBusiness = businessData.accountStatus === 'ACTIVE' || (businessData.accountStatus === 'TRIAL' && businessData.trialEndsAt instanceof Timestamp && businessData.trialEndsAt.toMillis() > now.toMillis())
  if (!activeBusiness) throw new HttpsError('permission-denied', 'The business account is not active.')
  const legacyOwner = !membership.exists && businessData.ownerUid === auth.uid && Array.isArray(businessData.memberUids) && businessData.memberUids.includes(auth.uid)
  const role = (legacyOwner ? 'owner' : membership.data()?.role) as BusinessRole
  if ((!legacyOwner && membership.data()?.status !== 'active') || !allowed.includes(role)) throw new HttpsError('permission-denied', 'Your staff role cannot perform this action.')
  return { uid: auth.uid, role, profileRef, profile: profileData, businessId, businessRef, business: businessData, membershipRef: businessRef.collection('members').doc(auth.uid), membership: membership.data(), displayName: String(membership.data()?.displayName ?? profileData.fullName ?? auth.token.name ?? 'Staff member') }
}
