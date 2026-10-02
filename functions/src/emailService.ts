export type InvitationEmail = {
  to: string
  businessName: string
  inviterName: string
  role: string
  invitationUrl: string
  passwordSetupUrl: string
  expiresAt: Date
}

export interface EmailService {
  sendStaffInvitation(message: InvitationEmail): Promise<{ messageId: string | null }>
}

export function createEmulatorEmailService(): EmailService {
  return {
    async sendStaffInvitation() {
      return { messageId: 'emulator-no-email' }
    }
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}

export function createResendEmailService(apiKey: string, from: string, supportEmail: string): EmailService {
  if (!apiKey || !from) throw new Error('Invitation email provider is not configured.')
  return {
    async sendStaffInvitation(message) {
      const business = escapeHtml(message.businessName)
      const inviter = escapeHtml(message.inviterName)
      const role = escapeHtml(message.role)
      const expires = escapeHtml(message.expiresAt.toUTCString())
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from,
          to: [message.to],
          subject: `You're invited to ${message.businessName} on SmallBizz`,
          html: `<h1>Join ${business} on SmallBizz</h1><p>${inviter} invited you as <strong>${role}</strong>.</p><p><a href="${escapeHtml(message.invitationUrl)}">Review invitation</a></p><p>If you need to set or reset your password, use <a href="${escapeHtml(message.passwordSetupUrl)}">this secure password link</a>.</p><p>This invitation expires ${expires}. If you did not expect it, decline it or contact ${escapeHtml(supportEmail)}.</p>`
        })
      })
      if (!response.ok) throw new Error(`Email provider rejected the request (${response.status}).`)
      const result = await response.json() as { id?: string }
      return { messageId: result.id ?? null }
    }
  }
}
