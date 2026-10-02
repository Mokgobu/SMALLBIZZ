import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app'
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check'
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth'
import {
  connectFirestoreEmulator,
  getFirestore,
  initializeFirestore,
  type Firestore,
  type FirestoreSettings
} from 'firebase/firestore'
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions'
import { getStorage, type FirebaseStorage } from 'firebase/storage'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY?.trim(),
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim(),
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim(),
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET?.trim(),
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim(),
  appId: import.meta.env.VITE_FIREBASE_APP_ID?.trim()
}

const requiredConfigKeys = ['apiKey', 'authDomain', 'projectId', 'appId'] as const
const emulatorRequested = import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true'

export const missingFirebaseConfig = requiredConfigKeys.filter(
  (key) => !firebaseConfig[key]
)

const unsafeEmulatorProject = emulatorRequested && !firebaseConfig.projectId?.startsWith('demo-')
const missingProductionAppCheck = import.meta.env.PROD && !import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY?.trim()

export const firebaseInitialized = missingFirebaseConfig.length === 0 && !unsafeEmulatorProject && !missingProductionAppCheck

let app: FirebaseApp | null = null
let auth: Auth | null = null
let db: Firestore | null = null
let storage: FirebaseStorage | null = null
let functions: Functions | null = null

if (firebaseInitialized) {
  app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig)
  auth = getAuth(app)
  const emulatorFirestoreSettings: FirestoreSettings & { useFetchStreams: boolean } = {
    experimentalForceLongPolling: true,
    experimentalLongPollingOptions: { timeoutSeconds: 5 },
    // Chrome can leave emulator WebChannel fetch streams pending even when the emulator is responding.
    // Keep the XHR fallback local-only; production retains the SDK's default transport.
    useFetchStreams: false
  }
  db = emulatorRequested
    ? initializeFirestore(app, emulatorFirestoreSettings)
    : getFirestore(app)
  storage = getStorage(app)
  functions = getFunctions(app, 'africa-south1')

  const useEmulators = emulatorRequested
  const appCheckSiteKey = import.meta.env.VITE_FIREBASE_APP_CHECK_SITE_KEY?.trim()
  if (!useEmulators && appCheckSiteKey) {
    initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey), isTokenAutoRefreshEnabled: true })
  }
  const emulatorState = globalThis as typeof globalThis & { __smallBizzEmulatorsConnected?: boolean }
  if (useEmulators && !emulatorState.__smallBizzEmulatorsConnected) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
    connectFirestoreEmulator(db, '127.0.0.1', 8080)
    connectFunctionsEmulator(functions, '127.0.0.1', 5001)
    emulatorState.__smallBizzEmulatorsConnected = true
  }
}

export { app, auth, db, firebaseConfig, functions, storage }

export function requireFirebase() {
  if (!auth || !db || !functions) {
    throw new Error(
      `Firebase is not configured. Missing: ${missingFirebaseConfig.join(', ')}`
    )
  }

  return { auth, db, functions }
}
