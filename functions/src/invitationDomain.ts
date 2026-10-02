import { createHash, randomBytes } from 'node:crypto'

export const INVITATION_STATUSES = ['pending', 'sent', 'delivery_failed', 'accepted', 'declined', 'expired'] as const
export type InvitationStatus = (typeof INVITATION_STATUSES)[number]

export function createInvitationToken() { return randomBytes(32).toString('base64url') }
export function hashInvitationToken(token: string) { return createHash('sha256').update(token).digest('hex') }

export function validateInvitationTokenInput(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('A valid invitation request is required.')
  const data = value as Record<string, unknown>
  if (Object.keys(data).some((key) => key !== 'token')) throw new Error('The invitation request contains unsupported fields.')
  const token = typeof data.token === 'string' ? data.token.trim() : ''
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(token)) throw new Error('The invitation link is invalid.')
  return token
}

export function normalizeEmail(value: unknown) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('Enter a valid email address.')
  return email
}

export function invitationCanBeResent(status: unknown) {
  return status === 'pending' || status === 'sent' || status === 'delivery_failed'
}

export function emailsMatch(invitedEmail: string, authenticatedEmail: unknown) {
  return invitedEmail.trim().toLowerCase() === String(authenticatedEmail ?? '').trim().toLowerCase()
}

export type InvitationOutcome = 'ready' | 'accepted_idempotent' | 'declined_idempotent' | 'consumed' | 'expired' | 'unavailable'
export function invitationOutcome(status: unknown, expiresAtMillis: number | null, nowMillis: number, linkedUid: unknown, callerUid: string): InvitationOutcome {
  if (status === 'accepted') return linkedUid === callerUid ? 'accepted_idempotent' : 'consumed'
  if (status === 'declined') return 'declined_idempotent'
  if (status !== 'sent') return 'unavailable'
  if (expiresAtMillis == null || expiresAtMillis <= nowMillis) return 'expired'
  return 'ready'
}
