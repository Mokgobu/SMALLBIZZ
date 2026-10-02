import { expect, test } from '@playwright/test'
import { Timestamp } from 'firebase-admin/firestore'
import { adminAuth, adminDb, PASSWORD, seedBusiness, seedUser } from './support/emulator'

const createdUserIds: string[] = []
let createdBusinessId: string | null = null

test.afterAll(async () => {
  await Promise.all(createdUserIds.map((uid) => adminAuth.deleteUser(uid).catch(() => undefined)))
  if (createdBusinessId) await adminDb.recursiveDelete(adminDb.doc(`businesses/${createdBusinessId}`)).catch(() => undefined)
  await Promise.all(createdUserIds.map((uid) => adminDb.doc(`users/${uid}`).delete().catch(() => undefined)))
})

async function signInAndObserveInitialization(page: import('@playwright/test').Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  const loader = page.getByRole('status')
  await expect(loader).toContainText(/Preparing your (workspace|dashboard)/)
  await loader.waitFor({ state: 'detached' })
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
}

test('cashier dashboard is authorized, financially limited, responsive, and route protected', async ({ browser }) => {
  test.setTimeout(180_000)
  createdBusinessId = await seedBusiness(`Dashboard Role Test ${Date.now()}`)
  const owner = await seedUser(createdBusinessId, 'owner', 'dashboard-owner')
  const cashier = await seedUser(createdBusinessId, 'cashier', 'dashboard-cashier')
  createdUserIds.push(owner.uid, cashier.uid)
  const now = Timestamp.now()

  await Promise.all([
    adminDb.doc(`businesses/${createdBusinessId}/products/kota`).set({
      name: 'Kota', description: '', sku: 'KOTA-1', barcode: '', category: 'Food', sellingPrice: 45,
      costPrice: 20, quantity: 1, reorderLevel: 2, trackStock: true, unit: 'item', status: 'active',
      lastMovementId: null, createdAt: now, updatedAt: now, createdBy: owner.uid
    }),
    adminDb.doc(`businesses/${createdBusinessId}/customers/customer-1`).set({
      firstName: 'Local', lastName: 'Customer', displayName: 'Local Customer', phone: '', email: '', birthday: null,
      notes: '', status: 'active', createdAt: now, updatedAt: now, createdBy: owner.uid
    }),
    adminDb.doc(`businesses/${createdBusinessId}/sales/sale-1`).set({
      items: [{ productId: 'kota', productName: 'Kota', sku: 'KOTA-1', quantity: 1, unitPrice: 45, costPrice: 20, lineTotal: 45 }],
      itemCount: 1, subtotal: 45, discount: 0, total: 45, grossProfit: 25, totalCost: 20,
      paymentMethod: 'cash', notes: '', customerId: 'customer-1', customerNameSnapshot: 'Local Customer',
      cashierNameSnapshot: 'E2E cashier', cashierRoleSnapshot: 'cashier', createdAt: now, createdBy: cashier.uid
    })
  ])

  const cashierContext = await browser.newContext({ viewport: { width: 375, height: 900 }, reducedMotion: 'reduce' })
  const cashierPage = await cashierContext.newPage()
  await signInAndObserveInitialization(cashierPage, cashier.email)
  const cashierMetrics = cashierPage.getByLabel('Business key performance indicators')
  await expect(cashierMetrics.getByText("Today's sales", { exact: true })).toBeVisible()
  await expect(cashierMetrics.getByText(/R\s*45[,.]00/)).toBeVisible()
  await expect(cashierMetrics.getByText("Today's transactions", { exact: true })).toBeVisible()
  await expect(cashierMetrics.getByText('Operating profit estimate', { exact: true })).toHaveCount(0)
  await expect(cashierMetrics.getByText('Expenses', { exact: true })).toHaveCount(0)
  await expect(cashierPage.getByRole('link', { name: /Inventory/ })).toHaveCount(0)
  await expect(cashierPage.getByRole('alert')).toHaveCount(0)
  expect(await cashierPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)

  for (const path of ['/inventory', '/expiry', '/expenses', '/suppliers', '/reports', '/operational-reports', '/staff', '/settings', '/recipes']) {
    await cashierPage.goto(path)
    await expect(cashierPage).toHaveURL(/\/$/)
    await expect(cashierPage.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  }
  await cashierContext.close()

  const ownerContext = await browser.newContext()
  const ownerPage = await ownerContext.newPage()
  await signInAndObserveInitialization(ownerPage, owner.email)
  const ownerMetrics = ownerPage.getByLabel('Business key performance indicators')
  await expect(ownerMetrics.getByText('Operating profit estimate', { exact: true })).toBeVisible()
  await expect(ownerMetrics.getByText('Expenses', { exact: true })).toBeVisible()
  await expect(ownerPage.getByRole('link', { name: /Inventory/ }).first()).toBeVisible()
  await ownerContext.close()
})
