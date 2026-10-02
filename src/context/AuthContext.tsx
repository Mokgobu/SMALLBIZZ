import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { getIdTokenResult, onAuthStateChanged, type User } from 'firebase/auth'
import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { permissionsForMembership, type Permission } from '../auth/permissions'
import { isAuthoritativeSnapshot } from '../auth/snapshotAuthority'
import { auth, db, firebaseInitialized, functions } from '../config/firebase'
import type { UserProfile } from '../models/auth'
import type { BusinessProfile } from '../models/business'
import type { BusinessMembership } from '../models/staff'
import { loginUser, logoutUser, sendPasswordReset } from '../services/auth'
import { getFirebaseErrorMessage } from '../utils/firebaseErrors'

type AuthContextValue = {
  user: User | null
  profile: UserProfile | null
  business: BusinessProfile | null
  membership: BusinessMembership | null
  permissions: readonly Permission[]
  loading: boolean
  error: string | null
  needsOnboarding: boolean
  hasPendingStaffInvitation: boolean
  isPlatformAdmin: boolean
  hasPermission: (permission: Permission) => boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  sendPasswordReset: (email: string) => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [business, setBusiness] = useState<BusinessProfile | null>(null)
  const [membership, setMembership] = useState<BusinessMembership | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false)
  const [hasPendingStaffInvitation, setHasPendingStaffInvitation] = useState(false)

  useEffect(() => {
    if (!firebaseInitialized || !auth || !db || !functions) {
      console.error('SmallBizz configuration validation failed. The application connection settings are incomplete.')
      setError('SmallBizz could not connect right now. Please retry, or contact support if the problem continues.')
      setLoading(false)
      return
    }

    const firebaseAuth = auth
    const firestore = db
    const activateInvite = httpsCallable(functions, 'acceptStaffInvite')
    const getPendingInvitationState = httpsCallable<Record<string, never>, { hasPendingInvitation: boolean }>(functions, 'getPendingStaffInvitationState')
    let unsubscribeProfile: Unsubscribe | undefined
    let unsubscribeMembership: Unsubscribe | undefined
    let unsubscribeBusiness: Unsubscribe | undefined
    let inviteActivationAttempted = false
    let authGeneration = 0
    let profileResolution = 0
    let verificationTimeout: ReturnType<typeof setTimeout> | undefined

    const clearVerificationTimeout = () => {
      if (verificationTimeout !== undefined) clearTimeout(verificationTimeout)
      verificationTimeout = undefined
    }

    const clearBusinessListeners = () => {
      unsubscribeMembership?.()
      unsubscribeBusiness?.()
      unsubscribeMembership = undefined
      unsubscribeBusiness = undefined
    }

    const clearAllListeners = () => {
      unsubscribeProfile?.()
      unsubscribeProfile = undefined
      clearBusinessListeners()
    }

    const listenForBusiness = (businessId: string, nextUser: User, allowLegacyOwner: boolean, generation: number) => {
      unsubscribeBusiness?.()
      unsubscribeBusiness = onSnapshot(
        doc(firestore, 'businesses', businessId),
        { includeMetadataChanges: true },
        (businessSnapshot) => {
          if (generation !== authGeneration || !isAuthoritativeSnapshot(businessSnapshot.metadata)) return
          if (!businessSnapshot.exists()) {
            setError('Your business profile could not be found. Contact the business owner for help.')
            clearVerificationTimeout()
            setLoading(false)
            return
          }
          const nextBusiness = { id: businessSnapshot.id, ...businessSnapshot.data() } as BusinessProfile
          if (allowLegacyOwner) {
            if (nextBusiness.ownerUid !== nextUser.uid || !nextBusiness.memberUids?.includes(nextUser.uid)) {
              setError('Your account does not have a valid business membership.')
              setLoading(false)
              return
            }
            setMembership({
              id: nextUser.uid,
              uid: nextUser.uid,
              displayName: nextUser.displayName ?? nextUser.email ?? 'Business owner',
              email: nextUser.email ?? '',
              role: 'owner',
              status: 'active',
              invitedBy: null
            })
          }
          setBusiness(nextBusiness)
          setError(null)
          clearVerificationTimeout()
          setLoading(false)
        },
        (snapshotError) => {
          if (generation !== authGeneration) return
          setError(getFirebaseErrorMessage(snapshotError, 'Unable to load your business profile.'))
          clearVerificationTimeout()
          setLoading(false)
        }
      )
    }

    const unsubscribeAuth = onAuthStateChanged(firebaseAuth, async (nextUser) => {
      const generation = ++authGeneration
      profileResolution++
      clearAllListeners()
      clearVerificationTimeout()
      inviteActivationAttempted = false
      setUser(nextUser)
      setProfile(null)
      setMembership(null)
      setBusiness(null)
      setError(null)
      setIsPlatformAdmin(false)
      setHasPendingStaffInvitation(false)

      if (!nextUser) {
        setLoading(false)
        return
      }

      setLoading(true)
      verificationTimeout = setTimeout(() => {
        if (generation !== authGeneration) return
        setError('SmallBizz could not verify your account right now. Check your connection and retry.')
        setLoading(false)
      }, 20_000)
      try {
        const token = await getIdTokenResult(nextUser)
        if (generation !== authGeneration) return
        setIsPlatformAdmin(token.claims.platformAdmin === true)
        unsubscribeProfile = onSnapshot(
          doc(firestore, 'users', nextUser.uid),
          { includeMetadataChanges: true },
          (profileSnapshot) => {
            if (generation !== authGeneration || !isAuthoritativeSnapshot(profileSnapshot.metadata)) return
            const resolution = ++profileResolution
            clearBusinessListeners()
            setMembership(null)
            setBusiness(null)
            if (!profileSnapshot.exists()) {
              setProfile(null)
              void getPendingInvitationState({}).then((result) => {
                if (generation !== authGeneration || resolution !== profileResolution) return
                setHasPendingStaffInvitation(result.data.hasPendingInvitation === true)
                clearVerificationTimeout()
                setLoading(false)
              }).catch((pendingError) => {
                if (generation !== authGeneration || resolution !== profileResolution) return
                setError(getFirebaseErrorMessage(pendingError, 'Unable to verify whether this account has a pending staff invitation.'))
                clearVerificationTimeout()
                setLoading(false)
              })
              return
            }

            const nextProfile = { id: profileSnapshot.id, ...profileSnapshot.data() } as UserProfile
            setProfile(nextProfile)
            const businessId = nextProfile.linkedBusinessId || nextProfile.businessId
            if (nextProfile.accountStatus !== 'ACTIVE' || !nextProfile.onboardingComplete || !businessId) {
              if (nextProfile.accountStatus !== 'ACTIVE') {
                clearVerificationTimeout()
                setLoading(false)
                return
              }
              void getPendingInvitationState({}).then((result) => {
                if (generation !== authGeneration || resolution !== profileResolution) return
                setHasPendingStaffInvitation(result.data.hasPendingInvitation === true)
                clearVerificationTimeout()
                setLoading(false)
              }).catch((pendingError) => {
                if (generation !== authGeneration || resolution !== profileResolution) return
                setError(getFirebaseErrorMessage(pendingError, 'Unable to verify whether this account has a pending staff invitation.'))
                clearVerificationTimeout()
                setLoading(false)
              })
              return
            }

            setHasPendingStaffInvitation(false)

            unsubscribeMembership = onSnapshot(
              doc(firestore, 'businesses', businessId, 'members', nextUser.uid),
              { includeMetadataChanges: true },
              (membershipSnapshot) => {
                if (generation !== authGeneration || !isAuthoritativeSnapshot(membershipSnapshot.metadata)) return
                unsubscribeBusiness?.()
                unsubscribeBusiness = undefined
                setBusiness(null)
                if (!membershipSnapshot.exists()) {
                  setMembership(null)
                  listenForBusiness(businessId, nextUser, true, generation)
                  return
                }

                const nextMembership = { id: membershipSnapshot.id, ...membershipSnapshot.data() } as BusinessMembership
                setMembership(nextMembership)
                if (nextMembership.status === 'invited' && !inviteActivationAttempted) {
                  inviteActivationAttempted = true
                  setLoading(true)
                  void activateInvite().catch((activationError) => {
                    if (generation !== authGeneration) return
                    setError(getFirebaseErrorMessage(activationError, 'Your staff invitation could not be activated.'))
                    clearVerificationTimeout()
                    setLoading(false)
                  })
                  return
                }
                if (nextMembership.status !== 'active') {
                  clearVerificationTimeout()
                  setLoading(false)
                  return
                }
                listenForBusiness(businessId, nextUser, false, generation)
              },
              (snapshotError) => {
                if (generation !== authGeneration) return
                setError(getFirebaseErrorMessage(snapshotError, 'Unable to load your business membership.'))
                clearVerificationTimeout()
                setLoading(false)
              }
            )
          },
          (snapshotError) => {
            if (generation !== authGeneration) return
            setError(getFirebaseErrorMessage(snapshotError, 'Unable to load your account profile.'))
            clearVerificationTimeout()
            setLoading(false)
          }
        )
      } catch (authError) {
        if (generation !== authGeneration) return
        setError(getFirebaseErrorMessage(authError, 'Unable to verify your account.'))
        clearVerificationTimeout()
        setLoading(false)
      }
    })

    return () => {
      unsubscribeAuth()
      authGeneration++
      clearVerificationTimeout()
      clearAllListeners()
    }
  }, [])

  const permissions = useMemo(() => permissionsForMembership(membership), [membership])
  const value = useMemo<AuthContextValue>(
    () => ({
      user, profile, business, membership, permissions, loading, error,
      needsOnboarding: Boolean(user && !hasPendingStaffInvitation && (!profile || !profile.onboardingComplete || !(profile.linkedBusinessId || profile.businessId))),
      hasPendingStaffInvitation,
      isPlatformAdmin,
      hasPermission: (permission) => permissions.includes(permission),
      login: loginUser,
      logout: logoutUser,
      sendPasswordReset
    }),
    [business, error, hasPendingStaffInvitation, isPlatformAdmin, loading, membership, permissions, profile, user]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
