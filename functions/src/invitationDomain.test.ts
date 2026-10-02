import assert from 'node:assert/strict'
import test from 'node:test'
import { createInvitationToken, emailsMatch, hashInvitationToken, invitationCanBeResent, invitationOutcome, normalizeEmail, validateInvitationTokenInput } from './invitationDomain.js'

test('invitation tokens are random, URL-safe, and stored only as deterministic hashes', () => {
  const first = createInvitationToken()
  const second = createInvitationToken()
  assert.notEqual(first, second)
  assert.match(first, /^[A-Za-z0-9_-]{40,100}$/)
  assert.equal(hashInvitationToken(first), hashInvitationToken(first))
  assert.notEqual(hashInvitationToken(first), first)
  assert.equal(hashInvitationToken(first).length, 64)
})

test('token requests reject malformed values and unsupported fields', () => {
  const token = createInvitationToken()
  assert.equal(validateInvitationTokenInput({ token }), token)
  assert.throws(() => validateInvitationTokenInput({ token: 'short' }), /invalid/i)
  assert.throws(() => validateInvitationTokenInput({ token, businessId: 'other' }), /unsupported/i)
})

test('recipient matching is case-insensitive but never accepts a different identity', () => {
  assert.equal(normalizeEmail(' Neo@Example.COM '), 'neo@example.com')
  assert.equal(emailsMatch('neo@example.com', 'NEO@EXAMPLE.COM'), true)
  assert.equal(emailsMatch('neo@example.com', 'other@example.com'), false)
  assert.throws(() => normalizeEmail('not-an-email'), /valid email/i)
})

test('only active delivery states can be resent', () => {
  for (const status of ['pending', 'sent', 'delivery_failed']) assert.equal(invitationCanBeResent(status), true)
  for (const status of ['accepted', 'declined', 'expired']) assert.equal(invitationCanBeResent(status), false)
})

test('invitation lifecycle is expiring, single-use, and idempotent for the same recipient', () => {
  assert.equal(invitationOutcome('sent', 2000, 1000, null, 'staff-a'), 'ready')
  assert.equal(invitationOutcome('sent', 1000, 1000, null, 'staff-a'), 'expired')
  assert.equal(invitationOutcome('accepted', 2000, 1000, 'staff-a', 'staff-a'), 'accepted_idempotent')
  assert.equal(invitationOutcome('accepted', 2000, 1000, 'staff-a', 'attacker'), 'consumed')
  assert.equal(invitationOutcome('declined', 2000, 1000, null, 'staff-a'), 'declined_idempotent')
  assert.equal(invitationOutcome('delivery_failed', 2000, 1000, null, 'staff-a'), 'unavailable')
})
