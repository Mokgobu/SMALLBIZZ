import { getAuth } from 'firebase-admin/auth'
import { FieldValue, Timestamp, getFirestore, type DocumentData, type Firestore } from 'firebase-admin/firestore'
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { assertTargetCanChange, validateRoleUpdate, validateStaffInvite, validateStatusUpdate } from './staffDomain.js'

type AuthContext = NonNullable<CallableRequest<unknown>['auth']>
export type StaffAuthAdmin = {
  getUserByEmail: (email: string) => Promise<{ uid: string }>
  createUser: (properties: { email: string; displayName: string; emailVerified: boolean; disabled: boolean }) => Promise<{ uid: string }>
  deleteUser: (uid: string) => Promise<void>
  generatePasswordResetLink: (email: string, settings?: { url: string }) => Promise<string>
  updateUser: (uid: string, properties: { disabled: boolean }) => Promise<unknown>
}

function message(error: unknown) {
  return error instanceof Error ? error.message : 'The staff request could not be completed.'
}

function businessIdFromProfile(profile: DocumentData) {
  const value = profile.linkedBusinessId ?? profile.businessId
  return typeof value === 'string' ? value.trim() : ''
}

export async function requireOwner(auth: AuthContext | undefined, db: Firestore) {
  if (!auth?.uid) throw new HttpsError('unauthenticated', 'Sign in before managing staff.')
  const profile = await db.doc(`users/${auth.uid}`).get()
  if (!profile.exists || profile.data()?.accountStatus !== 'ACTIVE') throw new HttpsError('permission-denied', 'Your account is not active.')
  const businessId = businessIdFromProfile(profile.data()!)
  if (!businessId) throw new HttpsError('failed-precondition', 'Your account is not linked to a business.')
  const businessRef = db.doc(`businesses/${businessId}`)
  const [business, membership] = await Promise.all([
    businessRef.get(),
    businessRef.collection('members').doc(auth.uid).get()
  ])
  if (!business.exists) throw new HttpsError('failed-precondition', 'The linked business is unavailable.')
  if (!['TRIAL', 'ACTIVE'].includes(business.data()?.accountStatus)) throw new HttpsError('permission-denied', 'The business account is not active.')
  const legacyOwner = !membership.exists
    && business.data()?.ownerUid === auth.uid
    && Array.isArray(business.data()?.memberUids)
    && business.data()?.memberUids.includes(auth.uid)
  if (!legacyOwner && (membership.data()?.status !== 'active' || membership.data()?.role !== 'owner')) {
    throw new HttpsError('permission-denied', 'Only the active business owner can manage staff.')
  }
  return {
    uid: auth.uid,
    businessId,
    businessRef,
    businessName: String(business.data()?.name ?? 'your business'),
    displayName: String(profile.data()?.fullName ?? profile.data()?.displayName ?? auth.token.name ?? 'The business owner')
  }
}

export function auditData(type: string, actorUid: string, targetUid: string, details: Record<string, unknown>, now: Timestamp) {
  return { type, actorUid, targetUid, ...details, createdAt: now }
}

export async function inviteStaffForRequest(data: unknown, auth: AuthContext | undefined, db: Firestore = getFirestore(), adminAuth: StaffAuthAdmin = getAuth()) {
  let input
  try { input = validateStaffInvite(data) } catch (error) { throw new HttpsError('invalid-argument', message(error)) }
  const caller = await requireOwner(auth, db)
  let authUser
  let createdAuthUser = false
  try {
    try {
      await adminAuth.getUserByEmail(input.email)
      throw new HttpsError('already-exists', 'An account already uses that email. Existing Auth accounts require a future consent-based linking flow.')
    }
    catch (error) {
      if (error instanceof HttpsError) throw error
      if ((error as { code?: string }).code !== 'auth/user-not-found') throw error
      authUser = await adminAuth.createUser({ email: input.email, displayName: input.name, emailVerified: false, disabled: false })
      createdAuthUser = true
    }

    const uid = authUser.uid
    const setupLink = await adminAuth.generatePasswordResetLink(input.email)
    const profileRef = db.doc(`users/${uid}`)
    const membershipRef = caller.businessRef.collection('members').doc(uid)
    const now = Timestamp.now()
    await db.runTransaction(async (transaction) => {
      const [profile, membership] = await Promise.all([transaction.get(profileRef), transaction.get(membershipRef)])
      const existingBusinessId = profile.exists ? businessIdFromProfile(profile.data()!) : ''
      if (existingBusinessId && existingBusinessId !== caller.businessId) {
        throw new HttpsError('already-exists', 'That email is already linked to another business.')
      }
      if (membership.exists) throw new HttpsError('already-exists', 'That person already has a membership in this business.')

      transaction.set(profileRef, {
        fullName: input.name,
        displayName: input.name,
        email: input.email,
        role: 'USER',
        accountStatus: 'ACTIVE',
        businessId: caller.businessId,
        linkedBusinessId: caller.businessId,
        onboardingComplete: true,
        termsVersion: profile.data()?.termsVersion ?? null,
        termsAcceptedAt: profile.data()?.termsAcceptedAt ?? null,
        createdAt: profile.data()?.createdAt ?? now,
        updatedAt: now
      }, { merge: true })
      transaction.create(membershipRef, {
        uid, displayName: input.name, email: input.email, role: input.role,
        status: 'invited', invitedBy: caller.uid, createdAt: now, updatedAt: now,
        joinedAt: null, lastActiveAt: null
      })
      transaction.update(caller.businessRef, { memberUids: FieldValue.arrayUnion(uid), updatedAt: now })
      transaction.create(caller.businessRef.collection('staffActivity').doc(), auditData('staff_invited', caller.uid, uid, { role: input.role }, now))
    })
    return { uid, status: 'invited' as const, setupLink }
  } catch (error) {
    if (createdAuthUser && authUser?.uid) await adminAuth.deleteUser(authUser.uid).catch(() => undefined)
    if (error instanceof HttpsError) throw error
    console.error('inviteStaff failed', error)
    throw new HttpsError('internal', 'Staff access could not be created.')
  }
}

export async function updateStaffRoleForRequest(data: unknown, auth: AuthContext | undefined, db: Firestore = getFirestore()) {
  let input
  try { input = validateRoleUpdate(data) } catch (error) { throw new HttpsError('invalid-argument', message(error)) }
  const caller = await requireOwner(auth, db)
  const memberRef = caller.businessRef.collection('members').doc(input.uid)
  try {
    await db.runTransaction(async (transaction) => {
      const target = await transaction.get(memberRef)
      if (!target.exists) throw new HttpsError('not-found', 'Staff membership was not found.')
      assertTargetCanChange(caller.uid, input.uid, target.data()?.role)
      const now = Timestamp.now()
      transaction.update(memberRef, { role: input.role, updatedAt: now })
      transaction.create(caller.businessRef.collection('staffActivity').doc(), auditData('staff_role_changed', caller.uid, input.uid, { actorName: caller.displayName, targetName: target.data()?.displayName ?? 'Staff member', previousRole: target.data()?.role, role: input.role, description: `${caller.displayName} changed ${target.data()?.displayName ?? 'a staff member'} from ${target.data()?.role ?? 'unknown'} to ${input.role}.` }, now))
    })
    return { ok: true as const }
  } catch (error) {
    if (error instanceof HttpsError) throw error
    if (error instanceof Error && /own authoritative|owner is protected/i.test(error.message)) throw new HttpsError('failed-precondition', error.message)
    console.error('updateStaffRole failed', error)
    throw new HttpsError('internal', 'The staff role could not be changed.')
  }
}

export async function updateStaffStatusForRequest(data: unknown, auth: AuthContext | undefined, db: Firestore = getFirestore(), adminAuth: StaffAuthAdmin = getAuth()) {
  let input
  try { input = validateStatusUpdate(data) } catch (error) { throw new HttpsError('invalid-argument', message(error)) }
  const caller = await requireOwner(auth, db)
  const memberRef = caller.businessRef.collection('members').doc(input.uid)
  try {
    await db.runTransaction(async (transaction) => {
      const target = await transaction.get(memberRef)
      if (!target.exists) throw new HttpsError('not-found', 'Staff membership was not found.')
      assertTargetCanChange(caller.uid, input.uid, target.data()?.role)
      const now = Timestamp.now()
      transaction.update(memberRef, { status: input.status, updatedAt: now })
      const activityType = input.status === 'active' ? 'staff_reactivated' : `staff_${input.status}`
      transaction.create(caller.businessRef.collection('staffActivity').doc(), auditData(activityType, caller.uid, input.uid, { actorName: caller.displayName, targetName: target.data()?.displayName ?? 'Staff member', previousStatus: target.data()?.status, status: input.status, description: `${caller.displayName} changed ${target.data()?.displayName ?? 'a staff member'} from ${target.data()?.status ?? 'unknown'} to ${input.status}.` }, now))
    })
    await adminAuth.updateUser(input.uid, { disabled: input.status === 'disabled' })
    return { ok: true as const }
  } catch (error) {
    if (error instanceof HttpsError) throw error
    if (error instanceof Error && /own authoritative|owner is protected/i.test(error.message)) throw new HttpsError('failed-precondition', error.message)
    console.error('updateStaffStatus failed', error)
    throw new HttpsError('internal', 'Staff access could not be changed.')
  }
}

export async function acceptStaffInviteForRequest(_data: unknown, auth: AuthContext | undefined, db: Firestore = getFirestore()) {
  if (!auth?.uid) throw new HttpsError('unauthenticated', 'Sign in to accept a staff invitation.')
  const profile = await db.doc(`users/${auth.uid}`).get()
  if (!profile.exists || profile.data()?.accountStatus !== 'ACTIVE') throw new HttpsError('permission-denied', 'Your account is not active.')
  const businessId = businessIdFromProfile(profile.data()!)
  if (!businessId) throw new HttpsError('failed-precondition', 'No staff invitation is linked to this account.')
  const businessRef = db.doc(`businesses/${businessId}`)
  const memberRef = businessRef.collection('members').doc(auth.uid)
  await db.runTransaction(async (transaction) => {
    const member = await transaction.get(memberRef)
    if (!member.exists) throw new HttpsError('not-found', 'Staff invitation was not found.')
    if (member.data()?.status === 'suspended' || member.data()?.status === 'disabled') throw new HttpsError('permission-denied', `This staff account is ${member.data()?.status}.`)
    const now = Timestamp.now()
    transaction.update(memberRef, {
      status: 'active',
      joinedAt: member.data()?.joinedAt ?? now,
      lastActiveAt: now,
      updatedAt: now
    })
    if (member.data()?.status === 'invited') {
      transaction.create(businessRef.collection('staffActivity').doc(), auditData('staff_joined', auth.uid, auth.uid, {}, now))
    }
  })
  return { ok: true as const }
}
