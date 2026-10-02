import assert from 'node:assert/strict'
import test from 'node:test'
import { createResendEmailService } from './emailService.js'

const message = { to: 'staff@example.com', businessName: 'A & B', inviterName: 'Owner', role: 'supervisor', invitationUrl: 'https://app.example/invite?t=abc', passwordSetupUrl: 'https://auth.example/reset', expiresAt: new Date('2026-09-10T00:00:00Z') }

test('email provider sends both consent and password links without leaking its credential', async () => {
  const original = globalThis.fetch
  let request: RequestInit | undefined
  globalThis.fetch = (async (_url, init) => { request = init; return new Response(JSON.stringify({ id: 'mail-1' }), { status: 200, headers: { 'content-type': 'application/json' } }) }) as typeof fetch
  try {
    const result = await createResendEmailService('secret-key', 'SmallBizz <invite@example.com>', 'help@example.com').sendStaffInvitation(message)
    assert.equal(result.messageId, 'mail-1')
    const body = String(request?.body)
    assert.match(body, /invite\?t=abc/)
    assert.match(body, /auth\.example\/reset/)
    assert.doesNotMatch(body, /secret-key/)
    assert.match(body, /A &amp; B/)
  } finally { globalThis.fetch = original }
})

test('email provider failures are recoverable errors for the invitation workflow', async () => {
  const original = globalThis.fetch
  globalThis.fetch = (async () => new Response('no', { status: 503 })) as typeof fetch
  try { await assert.rejects(() => createResendEmailService('key', 'from@example.com', 'help@example.com').sendStaffInvitation(message), /503/) }
  finally { globalThis.fetch = original }
})
