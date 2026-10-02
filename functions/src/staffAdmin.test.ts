import assert from 'node:assert/strict'
import test from 'node:test'
import { Timestamp, type Firestore } from 'firebase-admin/firestore'
import { inviteStaffForRequest, updateStaffRoleForRequest, updateStaffStatusForRequest, type StaffAuthAdmin } from './staffAdmin.js'
import { getPendingStaffInvitationStateForRequest, inviteStaffWithEmailForRequest, resendStaffInviteForRequest, respondToStaffInvitationForRequest } from './invitations.js'
import type { EmailService, InvitationEmail } from './emailService.js'

type Data = Record<string, unknown>

class MemorySnapshot {
  constructor(readonly ref: MemoryRef, private readonly value: Data | undefined) {}
  get exists() { return this.value !== undefined }
  get id() { return this.ref.path.split('/').at(-1) ?? '' }
  data() { return this.value }
}

class MemoryCollection {
  constructor(private readonly db: MemoryFirestore, readonly path: string) {}
  doc(id = `generated-${++this.db.ids}`) { return new MemoryRef(this.db, `${this.path}/${id}`) }
  get parent() { const parts = this.path.split('/'); return parts.length > 1 ? new MemoryRef(this.db, parts.slice(0, -1).join('/')) : null }
  where(field: string, _operator: string, value: unknown) { return new MemoryQuery(this.db, this.path, [[field, value]]) }
  async add(value: Data) { const ref = this.doc(); this.db.records.set(ref.path, { ...value }); return ref }
}

class MemoryQuery {
  constructor(private readonly db: MemoryFirestore, private readonly path: string, private readonly filters: Array<[string, unknown]>, private readonly group = false) {}
  where(field: string, _operator: string, value: unknown) { return new MemoryQuery(this.db, this.path, [...this.filters, [field, value]], this.group) }
  limit(_maximum: number) { return this }
  async get() {
    const docs = [...this.db.records.entries()].filter(([path, value]) => {
      const parts = path.split('/')
      const matchesPath = this.group ? parts.at(-2) === this.path : path.startsWith(`${this.path}/`) && parts.length === this.path.split('/').length + 1
      return matchesPath && this.filters.every(([field, expected]) => value[field] === expected)
    }).map(([path, value]) => new MemorySnapshot(new MemoryRef(this.db, path), value))
    return { docs, size: docs.length }
  }
}

class MemoryRef {
  constructor(private readonly db: MemoryFirestore, readonly path: string) {}
  get id() { return this.path.split('/').at(-1) ?? '' }
  get() { return Promise.resolve(new MemorySnapshot(this, this.db.records.get(this.path))) }
  collection(name: string) { return new MemoryCollection(this.db, `${this.path}/${name}`) }
  get parent() { return new MemoryCollection(this.db, this.path.split('/').slice(0, -1).join('/')) }
  async set(value: Data, options?: { merge?: boolean }) { this.db.records.set(this.path, options?.merge ? { ...this.db.records.get(this.path), ...value } : { ...value }) }
  async create(value: Data) { if (this.db.records.has(this.path)) throw new Error('already exists'); this.db.records.set(this.path, { ...value }) }
  async update(value: Data) { const current = this.db.records.get(this.path); if (!current) throw new Error('missing document'); this.db.records.set(this.path, { ...current, ...value }) }
  async delete() { this.db.records.delete(this.path) }
}

class MemoryTransaction {
  constructor(private readonly db: MemoryFirestore) {}
  get(ref: MemoryRef) { return ref.get() }
  set(ref: MemoryRef, value: Data, options?: { merge?: boolean }) {
    this.db.records.set(ref.path, options?.merge ? { ...this.db.records.get(ref.path), ...value } : { ...value })
  }
  create(ref: MemoryRef, value: Data) {
    if (this.db.records.has(ref.path)) throw new Error('already exists')
    this.db.records.set(ref.path, { ...value })
  }
  update(ref: MemoryRef, value: Data) {
    const current = this.db.records.get(ref.path)
    if (!current) throw new Error('missing document')
    this.db.records.set(ref.path, { ...current, ...value })
  }
}

class MemoryFirestore {
  records = new Map<string, Data>()
  ids = 0
  doc(path: string) { return new MemoryRef(this, path) }
  collectionGroup(name: string) { return new MemoryQuery(this, name, [], true) }
  runTransaction<T>(work: (transaction: MemoryTransaction) => Promise<T>) { return work(new MemoryTransaction(this)) }
}

class MemoryEmail implements EmailService {
  sent: InvitationEmail[] = []
  constructor(private readonly fail = false) {}
  async sendStaffInvitation(message: InvitationEmail) { this.sent.push(message); if (this.fail) throw new Error('provider failed'); return { messageId: 'mail-1' } }
}

class MemoryAuth implements StaffAuthAdmin {
  users = new Map<string, { uid: string }>()
  disabled = new Map<string, boolean>()
  deleted: string[] = []
  async getUserByEmail(email: string) {
    const user = this.users.get(email)
    if (!user) throw Object.assign(new Error('not found'), { code: 'auth/user-not-found' })
    return user
  }
  async createUser(properties: { email: string }) {
    const user = { uid: `auth-${this.users.size + 1}` }
    this.users.set(properties.email, user)
    return user
  }
  async deleteUser(uid: string) { this.deleted.push(uid) }
  async generatePasswordResetLink(email: string) { return `https://setup.example/${encodeURIComponent(email)}` }
  async updateUser(uid: string, properties: { disabled: boolean }) { this.disabled.set(uid, properties.disabled); return { uid } }
}

function context(uid: string) {
  return { uid, token: {} } as never
}
function emailContext(uid: string, email: string) { return { uid, token: { email, name: uid } } as never }
const noRateLimit = async () => undefined

function fixture(role: 'owner' | 'manager' = 'owner') {
  const memory = new MemoryFirestore()
  memory.records.set('users/owner', { accountStatus: 'ACTIVE', businessId: 'business-a', linkedBusinessId: 'business-a' })
  memory.records.set('businesses/business-a', { ownerUid: 'owner', memberUids: ['owner'], accountStatus: 'ACTIVE' })
  memory.records.set('businesses/business-a/members/owner', { uid: 'owner', role, status: 'active' })
  const auth = new MemoryAuth()
  return { memory, db: memory as unknown as Firestore, auth }
}

test('inviteStaff creates Auth/profile/membership records in the caller business', async () => {
  const { memory, db, auth } = fixture()
  const result = await inviteStaffForRequest({ name: ' Neo ', email: 'NEO@example.com', role: 'cashier' }, context('owner'), db, auth)
  assert.equal(result.status, 'invited')
  assert.match(result.setupLink, /neo%40example.com/)
  assert.equal(memory.records.get(`businesses/business-a/members/${result.uid}`)?.role, 'cashier')
  assert.equal(memory.records.get(`businesses/business-a/members/${result.uid}`)?.invitedBy, 'owner')
  assert.equal(memory.records.get(`users/${result.uid}`)?.linkedBusinessId, 'business-a')
})

test('inviteStaff rejects unauthenticated/non-owner callers, invalid roles, and existing Auth accounts', async () => {
  const { memory, db, auth } = fixture('manager')
  await assert.rejects(inviteStaffForRequest({ name: 'Neo', email: 'neo@example.com', role: 'cashier' }, context('owner'), db, auth), /Only the active business owner/)
  await assert.rejects(inviteStaffForRequest({ name: 'Neo', email: 'neo@example.com', role: 'owner' }, undefined, db, auth), /manager, supervisor, or cashier/)

  memory.records.set('businesses/business-a/members/owner', { uid: 'owner', role: 'owner', status: 'active' })
  memory.records.set('users/existing', { accountStatus: 'ACTIVE', businessId: 'business-b', linkedBusinessId: 'business-b' })
  auth.users.set('existing@example.com', { uid: 'existing' })
  await assert.rejects(inviteStaffForRequest({ name: 'Existing', email: 'existing@example.com', role: 'cashier' }, context('owner'), db, auth), /account already uses that email/)
})

test('owner can update staff role/status but cannot self-promote or modify an owner', async () => {
  const { memory, db, auth } = fixture()
  memory.records.set('businesses/business-a/members/staff', { uid: 'staff', role: 'cashier', status: 'active' })
  await updateStaffRoleForRequest({ uid: 'staff', role: 'supervisor' }, context('owner'), db)
  assert.equal(memory.records.get('businesses/business-a/members/staff')?.role, 'supervisor')
  await updateStaffStatusForRequest({ uid: 'staff', status: 'suspended' }, context('owner'), db, auth)
  assert.equal(memory.records.get('businesses/business-a/members/staff')?.status, 'suspended')
  assert.equal(auth.disabled.get('staff'), false)
  await updateStaffStatusForRequest({ uid: 'staff', status: 'disabled' }, context('owner'), db, auth)
  assert.equal(auth.disabled.get('staff'), true)
  await assert.rejects(updateStaffRoleForRequest({ uid: 'owner', role: 'manager' }, context('owner'), db), /own authoritative/)

  memory.records.set('businesses/business-a/members/other-owner', { uid: 'other-owner', role: 'owner', status: 'active' })
  await assert.rejects(updateStaffStatusForRequest({ uid: 'other-owner', status: 'suspended' }, context('owner'), db, auth), /owner is protected/i)
})

test('email invitation supports an existing Auth user without linking before consent and prevents duplicates', async () => {
  const { memory, db, auth } = fixture()
  memory.records.set('users/owner', { ...memory.records.get('users/owner'), fullName: 'Owner' })
  memory.records.set('businesses/business-a', { ...memory.records.get('businesses/business-a'), name: 'Coffee Shop' })
  auth.users.set('existing@example.com', { uid: 'existing' })
  const email = new MemoryEmail()
  const result = await inviteStaffWithEmailForRequest({ name: 'Existing', email: 'existing@example.com', role: 'supervisor' }, emailContext('owner', 'owner@example.com'), email, 'https://app.example', db, auth, noRateLimit)
  assert.equal(result.status, 'sent')
  assert.equal('testingInvitationUrl' in result, false)
  assert.equal('testingPasswordSetupUrl' in result, false)
  assert.equal(memory.records.has('businesses/business-a/members/existing'), false)
  assert.equal(email.sent.length, 1)
  const invitation = memory.records.get(`businesses/business-a/staffInvitations/${result.invitationId}`)!
  assert.equal(invitation.status, 'sent')
  assert.equal(typeof invitation.tokenHash, 'string')
  assert.equal('token' in invitation, false)
  memory.records.set(`businesses/business-a/staffInvitations/${result.invitationId}`, { ...invitation, lastDeliveryAt: Timestamp.fromMillis(1) })
  const resend = await resendStaffInviteForRequest({ invitationId: result.invitationId }, emailContext('owner', 'owner@example.com'), email, 'https://app.example', db, auth, noRateLimit)
  assert.equal(resend.status, 'sent')
  assert.equal('testingInvitationUrl' in resend, false)
  assert.equal('testingPasswordSetupUrl' in resend, false)
  assert.equal(memory.records.get(`businesses/business-a/staffInvitations/${result.invitationId}`)?.resendCount, 1)
  assert.equal(email.sent.length, 2)
  await assert.rejects(() => resendStaffInviteForRequest({ invitationId: result.invitationId }, emailContext('owner', 'owner@example.com'), email, 'https://app.example', db, auth, noRateLimit), /one minute/i)
  await assert.rejects(() => inviteStaffWithEmailForRequest({ name: 'Existing', email: 'existing@example.com', role: 'cashier' }, emailContext('owner', 'owner@example.com'), email, 'https://app.example', db, auth, noRateLimit), /active invitation already exists/i)
})

test('emulator invitation returns local links and resend rotates the token before authorized cashier acceptance', async () => {
  const { memory, db, auth } = fixture()
  memory.records.set('users/owner', { ...memory.records.get('users/owner'), fullName: 'Owner' })
  memory.records.set('businesses/business-a', { ...memory.records.get('businesses/business-a'), name: 'Coffee Shop' })
  const email = new MemoryEmail()
  const created = await inviteStaffWithEmailForRequest(
    { name: 'Local Cashier', email: 'cashier@example.com', role: 'cashier' },
    emailContext('owner', 'owner@example.com'), email, 'http://localhost:5173', db, auth, noRateLimit, true
  )
  assert.equal(created.status, 'sent')
  assert.match(created.testingInvitationUrl ?? '', /^http:\/\/localhost:5173\/staff-invitation\?token=/)
  assert.match(created.testingPasswordSetupUrl ?? '', /setup\.example\/cashier%40example\.com/)

  const invitedUser = await auth.getUserByEmail('cashier@example.com')
  assert.equal(memory.records.has(`businesses/business-a/members/${invitedUser.uid}`), false)
  assert.deepEqual(
    await getPendingStaffInvitationStateForRequest({}, emailContext(invitedUser.uid, 'cashier@example.com'), db, noRateLimit),
    { hasPendingInvitation: true }
  )
  assert.deepEqual(
    await getPendingStaffInvitationStateForRequest({}, emailContext('other-user', 'other@example.com'), db, noRateLimit),
    { hasPendingInvitation: false }
  )
  await assert.rejects(
    () => getPendingStaffInvitationStateForRequest({ token: 'not-allowed' }, emailContext(invitedUser.uid, 'cashier@example.com'), db, noRateLimit),
    /does not accept input fields/i
  )
  const oldToken = new URL(created.testingInvitationUrl!).searchParams.get('token')!
  const invitationPath = `businesses/business-a/staffInvitations/${created.invitationId}`
  memory.records.set(invitationPath, { ...memory.records.get(invitationPath), lastDeliveryAt: Timestamp.fromMillis(1) })

  const resent = await resendStaffInviteForRequest(
    { invitationId: created.invitationId }, emailContext('owner', 'owner@example.com'), email,
    'http://localhost:5173', db, auth, noRateLimit, true
  )
  assert.equal(resent.status, 'sent')
  assert.match(resent.testingPasswordSetupUrl ?? '', /setup\.example\/cashier%40example\.com/)
  assert.notEqual(resent.testingInvitationUrl, created.testingInvitationUrl)
  const newToken = new URL(resent.testingInvitationUrl!).searchParams.get('token')!
  assert.notEqual(newToken, oldToken)

  await assert.rejects(
    () => respondToStaffInvitationForRequest({ token: oldToken }, emailContext(invitedUser.uid, 'cashier@example.com'), 'accept', db, noRateLimit),
    /invalid or no longer available/i
  )
  await assert.rejects(
    () => respondToStaffInvitationForRequest({ token: newToken }, emailContext('attacker', 'wrong@example.com'), 'accept', db, noRateLimit),
    /email address that received/i
  )
  assert.equal(memory.records.has(`businesses/business-a/members/${invitedUser.uid}`), false)

  assert.deepEqual(
    await respondToStaffInvitationForRequest({ token: newToken }, emailContext(invitedUser.uid, 'cashier@example.com'), 'accept', db, noRateLimit),
    { status: 'accepted', alreadyCompleted: false }
  )
  assert.equal(memory.records.get(`businesses/business-a/members/${invitedUser.uid}`)?.role, 'cashier')
  assert.equal(memory.records.get(`businesses/business-a/members/${invitedUser.uid}`)?.status, 'active')
  assert.deepEqual(
    await getPendingStaffInvitationStateForRequest({}, emailContext(invitedUser.uid, 'cashier@example.com'), db, noRateLimit),
    { hasPendingInvitation: false }
  )
})

test('delivery failure stays recoverable and consent enforces recipient, expiry, replay, and cross-tenant conflicts', async () => {
  const { memory, db, auth } = fixture()
  memory.records.set('businesses/business-a', { ...memory.records.get('businesses/business-a'), name: 'Coffee Shop' })
  const failed = await inviteStaffWithEmailForRequest({ name: 'New', email: 'new@example.com', role: 'cashier' }, emailContext('owner', 'owner@example.com'), new MemoryEmail(true), 'https://app.example', db, auth, noRateLimit)
  assert.equal(failed.status, 'delivery_failed')

  auth.users.set('join@example.com', { uid: 'joiner' })
  const email = new MemoryEmail()
  const created = await inviteStaffWithEmailForRequest({ name: 'Joiner', email: 'join@example.com', role: 'cashier' }, emailContext('owner', 'owner@example.com'), email, 'https://app.example', db, auth, noRateLimit)
  const token = new URL(email.sent[0].invitationUrl).searchParams.get('token')!
  await assert.rejects(() => respondToStaffInvitationForRequest({ token }, emailContext('attacker', 'wrong@example.com'), 'accept', db, noRateLimit), /email address that received/i)
  memory.records.set('users/joiner', { accountStatus: 'ACTIVE', businessId: 'business-b', linkedBusinessId: 'business-b' })
  await assert.rejects(() => respondToStaffInvitationForRequest({ token }, emailContext('joiner', 'join@example.com'), 'accept', db, noRateLimit), /another business/i)
  memory.records.delete('users/joiner')
  assert.deepEqual(await respondToStaffInvitationForRequest({ token }, emailContext('joiner', 'join@example.com'), 'accept', db, noRateLimit), { status: 'accepted', alreadyCompleted: false })
  assert.deepEqual(await respondToStaffInvitationForRequest({ token }, emailContext('joiner', 'join@example.com'), 'accept', db, noRateLimit), { status: 'accepted', alreadyCompleted: true })
  assert.equal(memory.records.get('businesses/business-a/members/joiner')?.status, 'active')

  auth.users.set('expired@example.com', { uid: 'expired' })
  const expiryEmail = new MemoryEmail()
  const expiry = await inviteStaffWithEmailForRequest({ name: 'Expired', email: 'expired@example.com', role: 'cashier' }, emailContext('owner', 'owner@example.com'), expiryEmail, 'https://app.example', db, auth, noRateLimit)
  const expiryToken = new URL(expiryEmail.sent[0].invitationUrl).searchParams.get('token')!
  memory.records.set(`businesses/business-a/staffInvitations/${expiry.invitationId}`, { ...memory.records.get(`businesses/business-a/staffInvitations/${expiry.invitationId}`), expiresAt: Timestamp.fromMillis(1) })
  await assert.rejects(() => respondToStaffInvitationForRequest({ token: expiryToken }, emailContext('expired', 'expired@example.com'), 'accept', db, noRateLimit), /expired/i)
  assert.equal(memory.records.get(`businesses/business-a/staffInvitations/${expiry.invitationId}`)?.status, 'expired')

  auth.users.set('decline@example.com', { uid: 'decliner' })
  const declineEmail = new MemoryEmail()
  await inviteStaffWithEmailForRequest({ name: 'Decliner', email: 'decline@example.com', role: 'supervisor' }, emailContext('owner', 'owner@example.com'), declineEmail, 'https://app.example', db, auth, noRateLimit)
  const declineToken = new URL(declineEmail.sent[0].invitationUrl).searchParams.get('token')!
  assert.deepEqual(await respondToStaffInvitationForRequest({ token: declineToken }, emailContext('decliner', 'decline@example.com'), 'decline', db, noRateLimit), { status: 'declined', alreadyCompleted: false })
  assert.deepEqual(await respondToStaffInvitationForRequest({ token: declineToken }, emailContext('decliner', 'decline@example.com'), 'decline', db, noRateLimit), { status: 'declined', alreadyCompleted: true })
  assert.equal(memory.records.has('businesses/business-a/members/decliner'), false)
  assert.equal(created.status, 'sent')
})
