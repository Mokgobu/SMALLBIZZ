import {
  createUserWithEmailAndPassword,
  deleteUser,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from 'firebase/auth'
import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { requireFirebase } from '../config/firebase'

export async function registerUser(fullName: string, email: string, password: string) {
  const { auth, db } = requireFirebase()
  const credential = await createUserWithEmailAndPassword(auth, email, password)

  try {
    await updateProfile(credential.user, { displayName: fullName.trim() })
    await setDoc(doc(db, 'users', credential.user.uid), {
      fullName: fullName.trim(),
      email: credential.user.email,
      role: 'USER',
      accountStatus: 'ACTIVE',
      businessId: null,
      linkedBusinessId: null,
      onboardingComplete: false,
      termsVersion: null,
      termsAcceptedAt: null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    })
  } catch (error) {
    await deleteUser(credential.user).catch(() => undefined)
    throw error
  }

  return credential.user
}

export async function loginUser(email: string, password: string) {
  const { auth } = requireFirebase()
  await signInWithEmailAndPassword(auth, email, password)
}

export async function logoutUser() {
  const { auth } = requireFirebase()
  await signOut(auth)
}

export async function sendPasswordReset(email: string) {
  const { auth } = requireFirebase()
  await sendPasswordResetEmail(auth, email)
}
