import { defineConfig, devices } from '@playwright/test'

const projectId = 'demo-smallbizz'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 25_000 },
  reporter: [['line'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off'
  },
  webServer: {
    command: 'npm run e2e:serve',
    url: 'http://127.0.0.1:4173/login',
    reuseExistingServer: false,
    timeout: 300_000,
    env: {
      ...process.env,
      VITE_FIREBASE_API_KEY: 'emulator-only-key',
      VITE_FIREBASE_AUTH_DOMAIN: `${projectId}.firebaseapp.com`,
      VITE_FIREBASE_PROJECT_ID: projectId,
      VITE_FIREBASE_STORAGE_BUCKET: `${projectId}.appspot.com`,
      VITE_FIREBASE_MESSAGING_SENDER_ID: '100000000000',
      VITE_FIREBASE_APP_ID: '1:100000000000:web:emulator',
      VITE_USE_FIREBASE_EMULATORS: 'true',
      GCLOUD_PROJECT: projectId,
      FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
      FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
      FUNCTIONS_DISCOVERY_TIMEOUT: '60000',
      CI: 'true',
      STAFF_INVITE_APP_URL: 'http://127.0.0.1:4173'
    }
  },
  projects: [{ name: 'chrome', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }]
})
