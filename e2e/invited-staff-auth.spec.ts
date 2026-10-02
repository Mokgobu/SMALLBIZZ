import { expect, test } from '@playwright/test'
import { Timestamp } from 'firebase-admin/firestore'
import { adminAuth, adminDb, callFunction, expectFunctionRejected, PASSWORD, seedBusiness, seedUser, signInToken } from './support/emulator'

const createdUserIds: string[] = []
let createdBusinessId: string | null = null

test.afterAll(async () => {
  await Promise.all(createdUserIds.map((uid) => adminAuth.deleteUser(uid).catch(() => undefined)))
  if (createdBusinessId) await adminDb.recursiveDelete(adminDb.doc(`businesses/${createdBusinessId}`)).catch(() => undefined)
  await Promise.all(createdUserIds.map((uid) => adminDb.doc(`users/${uid}`).delete().catch(() => undefined)))
})

async function signIn(page: import('@playwright/test').Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

test('invited Supervisor bypasses onboarding only after secure invitation acceptance', async ({ browser, request }) => {
  test.setTimeout(300_000)
  createdBusinessId = await seedBusiness(`TEST BIZZ invitation QA ${Date.now()}`)
  const owner = await seedUser(createdBusinessId, 'owner', 'invite-owner')
  const cashier = await seedUser(createdBusinessId, 'cashier', 'existing-cashier')
  createdUserIds.push(owner.uid, cashier.uid)
  const ownerToken = await signInToken(request, owner.email)
  const invitedEmail = `supervisor-${Date.now()}@example.test`
  const invitation = await callFunction<{ testingInvitationUrl: string }>(request, 'inviteStaff', ownerToken, {
    name: 'Invited Supervisor', email: invitedEmail, role: 'supervisor'
  })
  expect(invitation.testingInvitationUrl).toContain('/staff-invitation?token=')
  const invitedUser = await adminAuth.getUserByEmail(invitedEmail)
  createdUserIds.push(invitedUser.uid)
  await adminAuth.updateUser(invitedUser.uid, { password: PASSWORD })
  const inviteUrl = new URL(invitation.testingInvitationUrl)
  const token = inviteUrl.searchParams.get('token')!

  const wrongUser = await adminAuth.createUser({ email: `wrong-${Date.now()}@example.test`, password: PASSWORD })
  createdUserIds.push(wrongUser.uid)
  const wrongToken = await signInToken(request, wrongUser.email!)
  await expectFunctionRejected(request, 'acceptStaffInvitation', wrongToken, { token }, /PERMISSION_DENIED|email address that received/i)

  const invitedContext = await browser.newContext()
  const invitedPage = await invitedContext.newPage()
  await signIn(invitedPage, invitedEmail)
  await expect(invitedPage).toHaveURL(/\/invitation-pending$/)
  await expect(invitedPage.getByRole('heading', { name: 'Pending staff invitation' })).toBeVisible()
  await expect(invitedPage.getByText(/Open the invitation link provided by your business owner/i)).toBeVisible()
  await expect(invitedPage.getByRole('heading', { name: 'Business onboarding' })).toHaveCount(0)
  expect((await adminDb.doc(`businesses/${createdBusinessId}/members/${invitedUser.uid}`).get()).exists).toBe(false)
  expect((await adminDb.doc(`users/${invitedUser.uid}`).get()).data()).toMatchObject({ businessId: null, linkedBusinessId: null, onboardingComplete: false })

  await invitedPage.goto(`${inviteUrl.pathname}${inviteUrl.search}`)
  await expect(invitedPage.getByRole('heading', { name: new RegExp(`Join TEST BIZZ invitation QA`) })).toBeVisible()
  const acceptResponse = invitedPage.waitForResponse((response) => response.url().includes('/acceptStaffInvitation') && response.request().method() === 'POST', { timeout: 60_000 })
  await invitedPage.getByRole('button', { name: 'Accept invitation' }).click()
  expect((await acceptResponse).ok()).toBe(true)
  await expect(invitedPage.getByText('Activating your business access...')).toBeVisible()
  await expect(invitedPage.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 60_000 })
  await expect(invitedPage.getByRole('main').getByText('supervisor', { exact: true })).toBeVisible()
  await expect(invitedPage.getByRole('main').getByText(new RegExp('TEST BIZZ invitation QA'))).toBeVisible()
  await expect(invitedPage.getByRole('heading', { name: 'Business onboarding' })).toHaveCount(0)

  const [profile, membership, acceptedInvitation] = await Promise.all([
    adminDb.doc(`users/${invitedUser.uid}`).get(),
    adminDb.doc(`businesses/${createdBusinessId}/members/${invitedUser.uid}`).get(),
    adminDb.collection(`businesses/${createdBusinessId}/staffInvitations`).where('invitedEmail', '==', invitedEmail).limit(1).get()
  ])
  expect(profile.data()).toMatchObject({ linkedBusinessId: createdBusinessId, onboardingComplete: true })
  expect(membership.data()).toMatchObject({ role: 'supervisor', status: 'active' })
  expect(acceptedInvitation.docs[0].data()).toMatchObject({ status: 'accepted', linkedUid: invitedUser.uid })
  expect(acceptedInvitation.docs[0].data().tokenConsumedAt).toBeTruthy()
  await expectFunctionRejected(request, 'acceptStaffInvitation', wrongToken, { token }, /PERMISSION_DENIED|email address that received/i)

  await invitedPage.getByRole('button', { name: 'Sign out' }).click()
  await signIn(invitedPage, invitedEmail)
  await expect(invitedPage.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 60_000 })
  await expect(invitedPage.getByRole('main').getByText('supervisor', { exact: true })).toBeVisible()
  await invitedContext.close()

  const independentEmail = `independent-${Date.now()}@example.test`
  const independent = await adminAuth.createUser({ email: independentEmail, password: PASSWORD, displayName: 'Independent Owner' })
  createdUserIds.push(independent.uid)
  await adminDb.doc(`users/${independent.uid}`).set({
    fullName: 'Independent Owner', email: independentEmail, role: 'USER', accountStatus: 'ACTIVE',
    businessId: null, linkedBusinessId: null, onboardingComplete: false, termsVersion: null,
    termsAcceptedAt: null, createdAt: Timestamp.now(), updatedAt: Timestamp.now()
  })
  const independentContext = await browser.newContext()
  const independentPage = await independentContext.newPage()
  await signIn(independentPage, independentEmail)
  await expect(independentPage.getByRole('heading', { name: 'Business onboarding' })).toBeVisible({ timeout: 60_000 })
  await independentContext.close()

  for (const account of [owner, cashier]) {
    const context = await browser.newContext()
    const page = await context.newPage()
    await signIn(page, account.email)
    await expect(page).toHaveURL(/\/$/)
    const shell = page.getByRole('complementary')
    await expect(shell.getByText(account.role, { exact: true })).toBeVisible()
    await expect(shell.getByRole('link', { name: 'Dashboard' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Business onboarding' })).toHaveCount(0)
    await context.close()
  }
})
