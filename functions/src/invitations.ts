import { getAuth } from 'firebase-admin/auth'
import { FieldValue, Timestamp, getFirestore, type Firestore } from 'firebase-admin/firestore'
import { logger } from 'firebase-functions'
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import type { EmailService } from './emailService.js'
import { createInvitationToken, emailsMatch, hashInvitationToken, invitationCanBeResent, invitationOutcome, validateInvitationTokenInput } from './invitationDomain.js'
import { consumeRateLimit } from './rateLimit.js'
import { auditData, requireOwner, type StaffAuthAdmin } from './staffAdmin.js'
import { validateStaffInvite } from './staffDomain.js'

type AuthContext = NonNullable<CallableRequest<unknown>['auth']>
type RateLimiter = typeof consumeRateLimit
const INVITATION_TTL_HOURS = 48
const RESEND_MINIMUM_SECONDS = 60
const MAX_TOTAL_RESENDS = 5

function safeError(error: unknown, fallback: string) {
  if (error instanceof HttpsError) return error
  logger.error(fallback, { error: error instanceof Error ? error.message : 'unknown' })
  return new HttpsError('internal', fallback)
}

function invitationUrl(baseUrl: string, token: string) {
  const url = new URL('/staff-invitation', baseUrl)
  url.searchParams.set('token', token)
  return url.toString()
}

async function deliver(
  emailService: EmailService,
  adminAuth: StaffAuthAdmin,
  data: { email: string; businessName: string; inviterName: string; role: string; url: string; expiresAt: Timestamp }
) {
  const passwordSetupUrl = await adminAuth.generatePasswordResetLink(data.email, { url: data.url })
  const delivery = await emailService.sendStaffInvitation({
    to: data.email,
    businessName: data.businessName,
    inviterName: data.inviterName,
    role: data.role,
    invitationUrl: data.url,
    passwordSetupUrl,
    expiresAt: data.expiresAt.toDate()
  })
  return { ...delivery, passwordSetupUrl }
}

export async function inviteStaffWithEmailForRequest(
  data: unknown,
  auth: AuthContext | undefined,
  emailService: EmailService,
  appUrl: string,
  db: Firestore = getFirestore(),
  adminAuth: StaffAuthAdmin = getAuth(),
  rateLimit: RateLimiter = consumeRateLimit,
  exposeTestingUrl = false
) {
  let input
  try { input = validateStaffInvite(data) } catch (error) { throw new HttpsError('invalid-argument', error instanceof Error ? error.message : 'Invalid invitation.') }
  const caller = await requireOwner(auth, db)
  const emailHash = hashInvitationToken(input.email)
  await rateLimit(db, `invite-owner-${caller.uid}`, 10, 3600)
  await rateLimit(db, `invite-business-${caller.businessId}`, 30, 3600)
  await rateLimit(db, `invite-email-${emailHash}`, 5, 86400)

  const existing = await caller.businessRef.collection('staffInvitations').where('emailHash', '==', emailHash).limit(10).get()
  if (existing.docs.some((item) => invitationCanBeResent(item.data().status))) {
    throw new HttpsError('already-exists', 'An active invitation already exists for this email. Resend that invitation instead.')
  }

  let authUser: { uid: string }
  let createdAuthUser = false
  let invitationCreated = false
  try {
    try { authUser = await adminAuth.getUserByEmail(input.email) }
    catch (error) {
      if ((error as { code?: string }).code !== 'auth/user-not-found') throw error
      authUser = await adminAuth.createUser({ email: input.email, displayName: input.name, emailVerified: false, disabled: false })
      createdAuthUser = true
      await db.doc(`users/${authUser.uid}`).set({
        fullName: input.name, displayName: input.name, email: input.email, role: 'USER',
        accountStatus: 'ACTIVE', businessId: null, linkedBusinessId: null,
        onboardingComplete: false, termsVersion: null, termsAcceptedAt: null,
        createdAt: Timestamp.now(), updatedAt: Timestamp.now()
      }, { merge: true })
    }

    const token = createInvitationToken()
    const tokenHash = hashInvitationToken(token)
    const now = Timestamp.now()
    const expiresAt = Timestamp.fromMillis(now.toMillis() + INVITATION_TTL_HOURS * 3600 * 1000)
    const ref = caller.businessRef.collection('staffInvitations').doc()
    const lockRef = caller.businessRef.collection('staffInvitationLocks').doc(emailHash)
    await db.runTransaction(async (transaction) => {
      const lock = await transaction.get(lockRef)
      if (lock.exists && invitationCanBeResent(lock.data()?.status)) throw new HttpsError('already-exists', 'An active invitation already exists for this email. Resend that invitation instead.')
      transaction.create(ref, {
        invitedEmail: input.email, emailHash, displayName: input.name, proposedRole: input.role,
        status: 'pending', invitedBy: caller.uid, inviterName: caller.displayName,
        businessName: caller.businessName, linkedUid: null, tokenHash,
        createdAt: now, updatedAt: now, expiresAt, acceptedAt: null, declinedAt: null,
        deliveryAttempts: 0, resendCount: 0, lastDeliveryAt: null, lastDeliveryError: null,
        providerMessageId: null
      })
      transaction.set(lockRef, { invitationId: ref.id, status: 'pending', expiresAt, updatedAt: now })
      transaction.create(caller.businessRef.collection('staffActivity').doc(), auditData('invitation_created', caller.uid, authUser.uid, {
        actorName: caller.displayName, targetName: input.name, role: input.role,
        description: `${caller.displayName} invited ${input.name} as ${input.role}.`, invitationId: ref.id
      }, now))
    })
    invitationCreated = true

    try {
      const url = invitationUrl(appUrl, token)
      const delivery = await deliver(emailService, adminAuth, { email: input.email, businessName: caller.businessName, inviterName: caller.displayName, role: input.role, url, expiresAt })
      const sentAt = Timestamp.now()
      await ref.update({ status: 'sent', deliveryAttempts: 1, lastDeliveryAt: sentAt, lastDeliveryError: null, providerMessageId: delivery.messageId, updatedAt: sentAt })
      await caller.businessRef.collection('staffActivity').add(auditData('invitation_sent', caller.uid, authUser.uid, {
        actorName: caller.displayName, targetName: input.name, role: input.role,
        description: `Invitation email sent to ${input.name}.`, invitationId: ref.id
      }, sentAt))
      return {
        invitationId: ref.id,
        status: 'sent' as const,
        ...(exposeTestingUrl ? { testingInvitationUrl: url, testingPasswordSetupUrl: delivery.passwordSetupUrl } : {})
      }
    } catch (deliveryError) {
      const failedAt = Timestamp.now()
      await ref.update({ status: 'delivery_failed', deliveryAttempts: 1, lastDeliveryAt: failedAt, lastDeliveryError: 'provider_error', updatedAt: failedAt })
      await caller.businessRef.collection('staffActivity').add(auditData('invitation_delivery_failed', caller.uid, authUser.uid, {
        actorName: caller.displayName, targetName: input.name,
        description: `Invitation delivery failed for ${input.name}. It can be resent.`, invitationId: ref.id
      }, failedAt))
      logger.warn('Staff invitation delivery failed.', { businessId: caller.businessId, invitationId: ref.id })
      return { invitationId: ref.id, status: 'delivery_failed' as const }
    }
  } catch (error) {
    if (createdAuthUser && !invitationCreated && authUser!.uid) await Promise.all([
      adminAuth.deleteUser(authUser!.uid).catch(() => undefined),
      db.doc(`users/${authUser!.uid}`).delete().catch(() => undefined)
    ])
    throw safeError(error, 'The staff invitation could not be created.')
  }
}

export async function resendStaffInviteForRequest(
  data: unknown,
  auth: AuthContext | undefined,
  emailService: EmailService,
  appUrl: string,
  db: Firestore = getFirestore(),
  adminAuth: StaffAuthAdmin = getAuth(),
  rateLimit: RateLimiter = consumeRateLimit,
  exposeTestingUrl = false
) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data as object).some((key) => key !== 'invitationId')) throw new HttpsError('invalid-argument', 'Choose a valid invitation.')
  const invitationId = typeof (data as { invitationId?: unknown })?.invitationId === 'string' ? (data as { invitationId: string }).invitationId.trim() : ''
  if (!/^[A-Za-z0-9_-]{1,150}$/.test(invitationId)) throw new HttpsError('invalid-argument', 'Choose a valid invitation.')
  const caller = await requireOwner(auth, db)
  const ref = caller.businessRef.collection('staffInvitations').doc(invitationId)
  await rateLimit(db, `resend-${caller.businessId}-${invitationId}`, 3, 3600)
  await rateLimit(db, `invite-owner-${caller.uid}`, 10, 3600)

  const token = createInvitationToken()
  const now = Timestamp.now()
  const expiresAt = Timestamp.fromMillis(now.toMillis() + INVITATION_TTL_HOURS * 3600 * 1000)
  const invitation = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists || !invitationCanBeResent(snapshot.data()?.status)) throw new HttpsError('failed-precondition', 'This invitation can no longer be resent.')
    const current = snapshot.data()!
    if (Number(current.resendCount ?? 0) >= MAX_TOTAL_RESENDS) throw new HttpsError('resource-exhausted', 'This invitation has reached its resend limit.')
    if (current.lastDeliveryAt instanceof Timestamp && now.seconds - current.lastDeliveryAt.seconds < RESEND_MINIMUM_SECONDS) throw new HttpsError('resource-exhausted', 'Wait at least one minute before resending.')
    transaction.update(ref, { tokenHash: hashInvitationToken(token), status: 'pending', expiresAt, resendCount: Number(current.resendCount ?? 0) + 1, lastDeliveryAt: now, updatedAt: now })
    return current
  })
  try {
    const url = invitationUrl(appUrl, token)
    const delivery = await deliver(emailService, adminAuth, { email: invitation.invitedEmail, businessName: invitation.businessName, inviterName: invitation.inviterName, role: invitation.proposedRole, url, expiresAt })
    const sentAt = Timestamp.now()
    await ref.update({ status: 'sent', deliveryAttempts: Number(invitation.deliveryAttempts ?? 0) + 1, lastDeliveryAt: sentAt, lastDeliveryError: null, providerMessageId: delivery.messageId, updatedAt: sentAt })
    await caller.businessRef.collection('staffActivity').add(auditData('invitation_resent', caller.uid, String(invitation.linkedUid ?? 'pending'), { actorName: caller.displayName, targetName: invitation.displayName ?? 'Invited staff', description: `Invitation email resent to ${invitation.displayName ?? 'staff member'}.`, invitationId }, sentAt))
    return {
      invitationId,
      status: 'sent' as const,
      ...(exposeTestingUrl ? { testingInvitationUrl: url, testingPasswordSetupUrl: delivery.passwordSetupUrl } : {})
    }
  } catch {
    const failedAt = Timestamp.now()
    await ref.update({ status: 'delivery_failed', deliveryAttempts: Number(invitation.deliveryAttempts ?? 0) + 1, lastDeliveryAt: failedAt, lastDeliveryError: 'provider_error', updatedAt: failedAt })
    await caller.businessRef.collection('staffActivity').add(auditData('invitation_resend_failed', caller.uid, String(invitation.linkedUid ?? 'pending'), { actorName: caller.displayName, targetName: invitation.displayName ?? 'Invited staff', description: `Invitation resend failed for ${invitation.displayName ?? 'staff member'}.`, invitationId }, failedAt))
    logger.warn('Staff invitation resend failed.', { businessId: caller.businessId, invitationId })
    return { invitationId, status: 'delivery_failed' as const }
  }
}

async function findInvitation(token: string, db: Firestore, rateLimit: RateLimiter) {
  const tokenHash = hashInvitationToken(token)
  await rateLimit(db, `invitation-token-${tokenHash.slice(0, 24)}`, 20, 900)
  const matches = await db.collectionGroup('staffInvitations').where('tokenHash', '==', tokenHash).limit(2).get()
  if (matches.size !== 1) {
    logger.warn('Invalid invitation token attempt.', { reason: matches.size > 1 ? 'duplicate_hash' : 'not_found' })
    throw new HttpsError('not-found', 'This invitation link is invalid or no longer available.')
  }
  return matches.docs[0]
}

function requireMatchingRecipient(invitation: FirebaseFirestore.DocumentData, auth: AuthContext | undefined) {
  if (!auth?.uid) throw new HttpsError('unauthenticated', 'Sign in with the invited email address.')
  if (!emailsMatch(invitation.invitedEmail, auth.token.email)) {
    logger.warn('Invitation email mismatch.', { invitationId: 'redacted', uid: auth.uid })
    throw new HttpsError('permission-denied', 'Sign in with the email address that received this invitation.')
  }
}

export async function getStaffInvitationForRequest(data: unknown, auth: AuthContext | undefined, db: Firestore = getFirestore(), rateLimit: RateLimiter = consumeRateLimit) {
  let token
  try { token = validateInvitationTokenInput(data) } catch (error) { throw new HttpsError('invalid-argument', error instanceof Error ? error.message : 'Invalid invitation.') }
  const snapshot = await findInvitation(token, db, rateLimit)
  const invitation = snapshot.data()
  requireMatchingRecipient(invitation, auth)
  const expired = invitation.expiresAt instanceof Timestamp && invitation.expiresAt.toMillis() <= Date.now()
  return {
    invitationId: snapshot.id,
    businessName: String(invitation.businessName ?? 'SmallBizz business'),
    inviterName: String(invitation.inviterName ?? 'Business owner'),
    displayName: String(invitation.displayName ?? 'Invited staff'),
    invitedEmail: String(invitation.invitedEmail ?? ''),
    proposedRole: invitation.proposedRole,
    status: expired ? 'expired' : invitation.status,
    expiresAt: invitation.expiresAt instanceof Timestamp ? invitation.expiresAt.toMillis() : null
  }
}

export async function getPendingStaffInvitationStateForRequest(
  data: unknown,
  auth: AuthContext | undefined,
  db: Firestore = getFirestore(),
  rateLimit: RateLimiter = consumeRateLimit,
  now = Timestamp.now()
) {
  if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data as object).length !== 0) {
    throw new HttpsError('invalid-argument', 'This request does not accept input fields.')
  }
  if (!auth?.uid || typeof auth.token.email !== 'string') throw new HttpsError('unauthenticated', 'Sign in to continue.')
  const emailHash = hashInvitationToken(auth.token.email.trim().toLowerCase())
  await rateLimit(db, `pending-invitation-${auth.uid}`, 30, 900)
  const matches = await db.collectionGroup('staffInvitations').where('emailHash', '==', emailHash).limit(10).get()
  const hasPendingInvitation = matches.docs.some((item) => {
    const invitation = item.data()
    return invitationCanBeResent(invitation.status)
      && invitation.expiresAt instanceof Timestamp
      && invitation.expiresAt.toMillis() > now.toMillis()
  })
  return { hasPendingInvitation }
}

export async function respondToStaffInvitationForRequest(data: unknown, auth: AuthContext | undefined, action: 'accept' | 'decline', db: Firestore = getFirestore(), rateLimit: RateLimiter = consumeRateLimit) {
  let token
  try { token = validateInvitationTokenInput(data) } catch (error) { throw new HttpsError('invalid-argument', error instanceof Error ? error.message : 'Invalid invitation.') }
  const snapshot = await findInvitation(token, db, rateLimit)
  const invitation = snapshot.data()
  requireMatchingRecipient(invitation, auth)
  const businessRef = snapshot.ref.parent.parent
  if (!businessRef) throw new HttpsError('internal', 'Invitation business is unavailable.')
  const result = await db.runTransaction(async (transaction) => {
    const currentSnapshot = await transaction.get(snapshot.ref)
    const current = currentSnapshot.data()!
    const lockRef = businessRef.collection('staffInvitationLocks').doc(String(current.emailHash ?? 'invalid'))
    requireMatchingRecipient(current, auth)
    const now = Timestamp.now()
    const outcome = invitationOutcome(current.status, current.expiresAt instanceof Timestamp ? current.expiresAt.toMillis() : null, now.toMillis(), current.linkedUid, auth!.uid)
    if (outcome === 'accepted_idempotent') return { status: 'accepted' as const, alreadyCompleted: true }
    if (outcome === 'declined_idempotent') return { status: 'declined' as const, alreadyCompleted: true }
    if (outcome === 'consumed') throw new HttpsError('failed-precondition', 'This invitation has already been used.')
    if (outcome === 'unavailable') throw new HttpsError('failed-precondition', 'This invitation is not available.')
    if (outcome === 'expired') {
      transaction.update(snapshot.ref, { status: 'expired', updatedAt: now })
      transaction.set(lockRef, { invitationId: snapshot.id, status: 'expired', expiresAt: current.expiresAt, updatedAt: now })
      return { status: 'expired' as const, alreadyCompleted: false }
    }
    if (action === 'decline') {
      transaction.update(snapshot.ref, { status: 'declined', declinedAt: now, updatedAt: now, tokenConsumedAt: now })
      transaction.set(lockRef, { invitationId: snapshot.id, status: 'declined', expiresAt: current.expiresAt, updatedAt: now })
      transaction.create(businessRef.collection('staffActivity').doc(), auditData('invitation_declined', auth!.uid, auth!.uid, { actorName: String(auth!.token.name ?? current.displayName ?? 'Invited staff'), targetName: String(current.displayName ?? 'Invited staff'), description: `${current.displayName ?? 'Invited staff'} declined the invitation.`, invitationId: snapshot.id }, now))
      return { status: 'declined' as const, alreadyCompleted: false }
    }

    const profileRef = db.doc(`users/${auth!.uid}`)
    const membershipRef = businessRef.collection('members').doc(auth!.uid)
    const [profile, existingMembership] = await Promise.all([transaction.get(profileRef), transaction.get(membershipRef)])
    const profileData = profile.data() ?? {}
    const linkedBusinessId = profileData.linkedBusinessId ?? profileData.businessId
    if (linkedBusinessId && linkedBusinessId !== businessRef.id) throw new HttpsError('already-exists', 'This account already belongs to another business.')
    if (existingMembership.exists && existingMembership.data()?.role === 'owner') throw new HttpsError('failed-precondition', 'An owner membership cannot be replaced.')
    transaction.set(profileRef, {
      fullName: profileData.fullName ?? current.displayName ?? auth!.token.name ?? '',
      displayName: profileData.displayName ?? current.displayName ?? auth!.token.name ?? '',
      email: auth!.token.email,
      role: 'USER', accountStatus: 'ACTIVE', businessId: businessRef.id, linkedBusinessId: businessRef.id,
      onboardingComplete: true, termsVersion: profileData.termsVersion ?? null,
      termsAcceptedAt: profileData.termsAcceptedAt ?? null, createdAt: profileData.createdAt ?? now, updatedAt: now
    }, { merge: true })
    transaction.set(membershipRef, {
      uid: auth!.uid, displayName: current.displayName ?? auth!.token.name ?? auth!.token.email,
      email: current.invitedEmail, role: current.proposedRole, status: 'active', invitedBy: current.invitedBy,
      createdAt: existingMembership.data()?.createdAt ?? current.createdAt ?? now,
      updatedAt: now, joinedAt: existingMembership.data()?.joinedAt ?? now, lastActiveAt: now
    }, { merge: true })
    transaction.update(businessRef, { memberUids: FieldValue.arrayUnion(auth!.uid), updatedAt: now })
    transaction.update(snapshot.ref, { status: 'accepted', acceptedAt: now, linkedUid: auth!.uid, updatedAt: now, tokenConsumedAt: now })
    transaction.set(lockRef, { invitationId: snapshot.id, status: 'accepted', expiresAt: current.expiresAt, updatedAt: now })
    transaction.create(businessRef.collection('staffActivity').doc(), auditData('invitation_accepted', auth!.uid, auth!.uid, { actorName: String(auth!.token.name ?? current.displayName ?? 'Invited staff'), targetName: String(current.displayName ?? 'Invited staff'), role: current.proposedRole, description: `${current.displayName ?? 'Invited staff'} accepted the ${current.proposedRole} invitation.`, invitationId: snapshot.id }, now))
    transaction.create(businessRef.collection('staffActivity').doc(), auditData('staff_joined', auth!.uid, auth!.uid, { actorName: String(auth!.token.name ?? current.displayName ?? 'Invited staff'), targetName: String(current.displayName ?? 'Invited staff'), role: current.proposedRole, description: `${current.displayName ?? 'Staff member'} joined the business.`, invitationId: snapshot.id }, now))
    return { status: 'accepted' as const, alreadyCompleted: false }
  })
  if (result.status === 'expired') throw new HttpsError('deadline-exceeded', 'This invitation has expired. Ask the owner to resend it.')
  return result
}
