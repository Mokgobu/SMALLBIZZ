import { FirebaseError } from 'firebase/app'

const messages: Record<string, string> = {
  'auth/email-already-in-use': 'An account already exists for this email address.',
  'auth/invalid-credential': 'The email address or password is incorrect.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/too-many-requests': 'Too many attempts. Please wait and try again.',
  'auth/user-disabled': 'This sign-in has been disabled. Contact support.',
  'auth/weak-password': 'Use a stronger password with at least six characters.',
  'permission-denied': 'You do not have permission to access this information.',
  unavailable: 'The service is temporarily unavailable. Check your connection and try again.'
}

export function getFirebaseErrorMessage(
  error: unknown,
  fallback = 'Something went wrong. Please try again.'
) {
  if (error instanceof FirebaseError) {
    const normalizedCode = error.code.replace(/^firestore\//, '')
    return messages[error.code] ?? messages[normalizedCode] ?? fallback
  }

  if (error instanceof Error && error.message.startsWith('Firebase is not configured')) {
    console.error('SmallBizz configuration error', error)
    return 'SmallBizz could not connect right now. Please retry, or contact support if the problem continues.'
  }

  return fallback
}
