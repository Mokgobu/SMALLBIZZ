import type { InviteStaffResult } from '../models/staff'

export type LocalInvitationLinks = {
  invitationUrl: string
  passwordSetupUrl: string
  previousInvitationLinkInvalid: boolean
}

export function invitationFeedback(result: InviteStaffResult, action: 'invite' | 'resend') {
  if (result.status === 'delivery_failed') {
    return {
      message: action === 'invite'
        ? 'The invitation was saved, but email delivery failed. You can retry it below.'
        : 'The retry was saved, but delivery failed again.',
      localLinks: null
    }
  }

  const hasLocalLinks = Boolean(result.testingInvitationUrl && result.testingPasswordSetupUrl)
  if (hasLocalLinks) {
    return {
      message: action === 'invite'
        ? 'Local invitation created. No email was sent.'
        : 'Local invitation replaced. No email was sent. The previous invitation link is invalid.',
      localLinks: {
        invitationUrl: result.testingInvitationUrl!,
        passwordSetupUrl: result.testingPasswordSetupUrl!,
        previousInvitationLinkInvalid: action === 'resend'
      } satisfies LocalInvitationLinks
    }
  }

  return {
    message: action === 'invite'
      ? 'Invitation submitted for email delivery.'
      : 'Invitation resubmitted for email delivery.',
    localLinks: null
  }
}
