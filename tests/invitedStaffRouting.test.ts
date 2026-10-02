import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const guards = readFileSync(new URL('../src/components/routing/RouteGuards.tsx', import.meta.url), 'utf8')
const invitation = readFileSync(new URL('../src/pages/StaffInvitation.tsx', import.meta.url), 'utf8')
const pending = readFileSync(new URL('../src/pages/PendingStaffInvitation.tsx', import.meta.url), 'utf8')
const authContext = readFileSync(new URL('../src/context/AuthContext.tsx', import.meta.url), 'utf8')

test('pending invited staff are routed away from business onboarding without granting membership', () => {
  assert.match(guards, /hasPendingStaffInvitation.*invitation-pending/s)
  assert.match(guards, /OnboardingRoute[\s\S]*hasPendingStaffInvitation[\s\S]*invitation-pending/)
  assert.match(pending, /Open the invitation link provided by your business owner to continue/)
  assert.doesNotMatch(pending, /acceptStaffInvitation|setDoc|writeBatch/)
  assert.match(authContext, /getPendingStaffInvitationState/)
  assert.match(authContext, /!hasPendingStaffInvitation/)
})

test('invitation acceptance waits for authoritative active membership and business resolution', () => {
  assert.match(invitation, /membership\?\.status === 'active' && business/)
  assert.match(invitation, /Activating your business access/)
  assert.match(invitation, /could not verify the new business membership yet/)
  assert.doesNotMatch(invitation, /await call\(\{ token \}\)\s*\n\s*if \(action === 'accept'\) navigate/)
})
