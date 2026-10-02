import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { FieldValue, Timestamp, getFirestore } from 'firebase-admin/firestore'
import type { APIRequestContext, Page } from '@playwright/test'

export const PROJECT_ID = 'demo-smallbizz'
export const AUTH_URL = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1'
export const FUNCTIONS_URL = `http://127.0.0.1:5001/${PROJECT_ID}/africa-south1`
export const PASSWORD = 'LocalE2E!234'

process.env.GCLOUD_PROJECT = PROJECT_ID
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'

const app = getApps().find((item) => item.name === 'smallbizz-e2e') ?? initializeApp({ projectId: PROJECT_ID }, 'smallbizz-e2e')
export const adminDb = getFirestore(app)
export const adminAuth = getAuth(app)

export async function resetEmulators(request: APIRequestContext) {
  const [firestore, auth] = await Promise.all([
    request.delete(`http://127.0.0.1:8080/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`),
    request.delete(`http://127.0.0.1:9099/emulator/v1/projects/${PROJECT_ID}/accounts`)
  ])
  if (!firestore.ok() || !auth.ok()) throw new Error(`Unable to reset emulators (${firestore.status()}/${auth.status()}).`)
}

export type SeedRole = 'owner' | 'manager' | 'supervisor' | 'cashier'

export async function seedBusiness(name = 'E2E Corner Store') {
  const ref = adminDb.collection('businesses').doc()
  await ref.set({
    name,
    type: 'Retail',
    ownerUid: 'pending',
    memberUids: [],
    accountStatus: 'TRIAL',
    trialEndsAt: Timestamp.fromMillis(Date.now() + 7 * 86_400_000),
    onboardingComplete: true,
    currency: 'ZAR',
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now()
  })
  return ref.id
}

export async function seedUser(businessId: string, role: SeedRole, prefix = role) {
  const email = `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.test`
  const user = await adminAuth.createUser({ email, password: PASSWORD, displayName: `E2E ${role}` })
  const now = Timestamp.now()
  await Promise.all([
    adminDb.doc(`users/${user.uid}`).set({
      fullName: `E2E ${role}`,
      displayName: `E2E ${role}`,
      email,
      role: 'USER',
      accountStatus: 'ACTIVE',
      businessId,
      linkedBusinessId: businessId,
      onboardingComplete: true,
      createdAt: now,
      updatedAt: now
    }),
    adminDb.doc(`businesses/${businessId}/members/${user.uid}`).set({
      uid: user.uid,
      displayName: `E2E ${role}`,
      email,
      role,
      status: 'active',
      invitedBy: role === 'owner' ? null : 'e2e-owner',
      createdAt: now,
      updatedAt: now,
      joinedAt: now,
      lastActiveAt: now
    }),
    adminDb.doc(`businesses/${businessId}`).update({
      ...(role === 'owner' ? { ownerUid: user.uid } : {}),
      memberUids: FieldValue.arrayUnion(user.uid),
      updatedAt: now
    })
  ])
  return { uid: user.uid, email, password: PASSWORD, role }
}

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByRole('status').waitFor({ state: 'detached' })
  await page.getByRole('complementary').getByText('SmallBizz', { exact: true }).waitFor()
}

export async function signInToken(request: APIRequestContext, email: string, password = PASSWORD) {
  const response = await request.post(`${AUTH_URL}/accounts:signInWithPassword?key=emulator-only-key`, {
    data: { email, password, returnSecureToken: true }
  })
  if (!response.ok()) throw new Error(`Emulator sign-in failed (${response.status()}): ${await response.text()}`)
  return (await response.json() as { idToken: string }).idToken
}

export async function callFunction<T>(request: APIRequestContext, name: string, token: string, data: unknown): Promise<T> {
  const response = await request.post(`${FUNCTIONS_URL}/${name}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { data }
  })
  const body = await response.json() as { result?: T; error?: { status?: string; message?: string } }
  if (!response.ok() || body.error) throw new Error(`${body.error?.status ?? response.status()}: ${body.error?.message ?? 'Callable failed'}`)
  return body.result as T
}

export async function expectFunctionRejected(request: APIRequestContext, name: string, token: string, data: unknown, pattern: RegExp) {
  const response = await request.post(`${FUNCTIONS_URL}/${name}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { data }
  })
  const body = await response.json() as { error?: { status?: string; message?: string } }
  const detail = `${body.error?.status ?? response.status()} ${body.error?.message ?? ''}`
  if (response.ok() && !body.error) throw new Error(`Expected ${name} to reject the request.`)
  if (!pattern.test(detail)) throw new Error(`Unexpected ${name} rejection: ${detail}`)
}

export async function assertNoCustomerDebugText(page: Page) {
  const body = await page.locator('body').innerText()
  const forbidden = [/F12/i, /browser console/i, /stack trace/i, /Unhandled promise/i, /\[object Object\]/, /\bundefined\b/, /\bnull\b/]
  for (const pattern of forbidden) {
    if (pattern.test(body)) throw new Error(`Customer UI exposed forbidden text: ${pattern}`)
  }
}
