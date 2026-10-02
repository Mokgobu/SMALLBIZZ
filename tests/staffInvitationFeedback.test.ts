import assert from 'node:assert/strict'
import test from 'node:test'
import { invitationFeedback } from '../src/staff/invitationFeedback'

test('emulator invitation feedback exposes local controls without claiming email was sent', () => {
  const feedback = invitationFeedback({
    invitationId: 'invite-1',
    status: 'sent',
    testingInvitationUrl: 'http://localhost:5173/staff-invitation?token=local-token',
    testingPasswordSetupUrl: 'http://127.0.0.1:9099/emulator/action?mode=resetPassword'
  }, 'invite')

  assert.equal(feedback.message, 'Local invitation created. No email was sent.')
  assert.doesNotMatch(feedback.message, /invitation email sent/i)
  assert.deepEqual(feedback.localLinks, {
    invitationUrl: 'http://localhost:5173/staff-invitation?token=local-token',
    passwordSetupUrl: 'http://127.0.0.1:9099/emulator/action?mode=resetPassword',
    previousInvitationLinkInvalid: false
  })
})

test('emulator resend feedback identifies replacement links and invalidates the previous link', () => {
  const feedback = invitationFeedback({
    invitationId: 'invite-1',
    status: 'sent',
    testingInvitationUrl: 'http://localhost:5173/staff-invitation?token=replacement-token',
    testingPasswordSetupUrl: 'http://127.0.0.1:9099/emulator/action?mode=resetPassword&new=1'
  }, 'resend')

  assert.match(feedback.message, /previous invitation link is invalid/i)
  assert.equal(feedback.localLinks?.previousInvitationLinkInvalid, true)
})

test('production invitation feedback exposes no local testing controls', () => {
  const invite = invitationFeedback({ invitationId: 'invite-1', status: 'sent' }, 'invite')
  const resend = invitationFeedback({ invitationId: 'invite-1', status: 'sent' }, 'resend')

  assert.equal(invite.message, 'Invitation submitted for email delivery.')
  assert.equal(invite.localLinks, null)
  assert.equal(resend.message, 'Invitation resubmitted for email delivery.')
  assert.equal(resend.localLinks, null)
})
