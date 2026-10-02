import { expect, test } from '@playwright/test'
import { adminDb, assertNoCustomerDebugText, login, resetEmulators, seedBusiness, seedUser } from './support/emulator'

test.beforeEach(async ({ request }) => resetEmulators(request))

test('owner registration and onboarding creates tenant membership and correct navigation', async ({ page }) => {
  const email = `owner-${Date.now()}@example.test`
  await page.goto('/register')
  await page.getByLabel('Full name').fill('E2E Owner')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('LocalE2E!234')
  await page.getByRole('button', { name: 'Create account' }).click()

  await expect(page.getByRole('heading', { name: 'Business onboarding' })).toBeVisible()
  await page.getByRole('button', { name: 'Save and continue' }).click()
  await expect(page.getByLabel('Business name')).toHaveJSProperty('validity.valueMissing', true)
  await page.getByLabel('Business name').fill('Soweto E2E Market')
  await page.getByLabel('Business type').selectOption('Retail')
  await page.getByLabel(/I accept the SmallBizz Terms/).check()
  await page.getByRole('button', { name: 'Save and continue' }).click()

  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await expect(page.getByText('Soweto E2E Market', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Staff' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Recipes' })).toBeVisible()
  await assertNoCustomerDebugText(page)

  await page.reload()
  await expect(page.getByText('Soweto E2E Market', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('LocalE2E!234')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByText('Soweto E2E Market', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  const userQuery = await adminDb.collection('users').where('email', '==', email).limit(1).get()
  expect(userQuery.size).toBe(1)
  const businessId = userQuery.docs[0].data().linkedBusinessId as string
  const [business, member] = await Promise.all([
    adminDb.doc(`businesses/${businessId}`).get(),
    adminDb.doc(`businesses/${businessId}/members/${userQuery.docs[0].id}`).get()
  ])
  expect(business.data()?.name).toBe('Soweto E2E Market')
  expect(business.data()?.memberUids).toContain(userQuery.docs[0].id)
  expect(member.data()).toMatchObject({ role: 'owner', status: 'active' })
})

test('owner, manager, supervisor and cashier receive role navigation and URL enforcement', async ({ browser }) => {
  const businessId = await seedBusiness()
  const users = {
    owner: await seedUser(businessId, 'owner'),
    manager: await seedUser(businessId, 'manager'),
    supervisor: await seedUser(businessId, 'supervisor'),
    cashier: await seedUser(businessId, 'cashier')
  }

  for (const [role, user] of Object.entries(users)) {
    const context = await browser.newContext()
    const page = await context.newPage()
    await login(page, user.email)
    await expect(page.getByText(role, { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
    if (role === 'owner') await expect(page.getByRole('link', { name: 'Staff' })).toBeVisible()
    else await expect(page.getByRole('link', { name: 'Staff' })).toHaveCount(0)
    if (role === 'cashier') {
      await expect(page.getByRole('link', { name: 'Inventory' })).toHaveCount(0)
      const cashierMetrics = page.getByLabel('Business key performance indicators')
      await expect(cashierMetrics.getByText("Today's sales", { exact: true })).toBeVisible()
      await expect(cashierMetrics.getByText("Today's transactions", { exact: true })).toBeVisible()
      await expect(cashierMetrics.getByText('Operating profit estimate', { exact: true })).toHaveCount(0)
      await expect(cashierMetrics.getByText('Expenses', { exact: true })).toHaveCount(0)
      await expect(page.getByRole('link', { name: /Inventory/ })).toHaveCount(0)
      await expect(page.getByRole('alert')).toHaveCount(0)
      for (const protectedPath of ['/inventory', '/expiry', '/expenses', '/suppliers', '/reports', '/operational-reports', '/staff', '/settings', '/recipes']) {
        await page.goto(protectedPath)
        await expect(page).toHaveURL(/\/$/)
        await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
      }
    }
    if (role === 'owner') {
      const ownerMetrics = page.getByLabel('Business key performance indicators')
      await expect(ownerMetrics.getByText('Operating profit estimate', { exact: true })).toBeVisible()
      await expect(ownerMetrics.getByText('Expenses', { exact: true })).toBeVisible()
    }
    if (role === 'manager') await expect(page.getByRole('link', { name: 'Reports' })).toBeVisible()
    if (role === 'supervisor') await expect(page.getByRole('link', { name: 'Recipes' })).toBeVisible()
    await context.close()
  }
})

test('protected routes restore the authenticated tenant after refresh', async ({ page }) => {
  const businessId = await seedBusiness('Refresh Test Business')
  const owner = await seedUser(businessId, 'owner')
  await login(page, owner.email)
  const context = page.context()
  await page.close()
  for (const path of ['/dashboard', '/sales', '/inventory', '/expiry', '/recipes', '/kitchen', '/staff', '/reports']) {
    const routePage = await context.newPage()
    await routePage.goto(path)
    await routePage.reload()
    await expect(routePage.getByText('Refresh Test Business', { exact: true })).toBeVisible()
    await expect(routePage).toHaveURL(new RegExp(`${path.replace('/', '\\/')}$`))
    await assertNoCustomerDebugText(routePage)
    await routePage.close()
  }
})

test('priority routes do not create page-level horizontal overflow at 375, 768 and 1280px', async ({ page }) => {
  const businessId = await seedBusiness('Responsive Test Business')
  const owner = await seedUser(businessId, 'owner')
  await login(page, owner.email)
  const paths = ['/', '/sales', '/products', '/inventory', '/expiry', '/promotions', '/recipes', '/kitchen', '/staff', '/reports']
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    for (const path of paths) {
      await page.goto(path)
      await page.locator('main').first().waitFor()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(overflow, `${path} at ${width}px`).toBeLessThanOrEqual(1)
    }
  }
})

test('public forms have labels, keyboard focus and a reduced-motion-safe startup state', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/login')
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByLabel('Password')).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(page.locator(':focus-visible')).toBeVisible()
  await assertNoCustomerDebugText(page)
})
