import type { ReactElement } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import AccountUnavailable from '../feedback/AccountUnavailable'
import LoadingScreen from '../feedback/LoadingScreen'
import type { Permission } from '../../auth/permissions'

type GuardProps = { children: ReactElement }

export function PublicOnlyRoute({ children }: GuardProps) {
  const { user, loading, needsOnboarding, hasPendingStaffInvitation } = useAuth()
  const location = useLocation()

  if (loading) return <LoadingScreen />
  if (!user) return children
  if ((location.state as { from?: { pathname?: string } } | null)?.from?.pathname === '/staff-invitation') return children
  return <Navigate to={hasPendingStaffInvitation ? '/invitation-pending' : needsOnboarding ? '/onboarding' : '/'} replace />
}

export function ProtectedRoute({ children }: GuardProps) {
  const { user, profile, business, membership, loading, error, needsOnboarding, hasPendingStaffInvitation } = useAuth()
  const location = useLocation()

  if (loading) return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />
  if (profile?.accountStatus === 'SUSPENDED' || profile?.accountStatus === 'CANCELLED') {
    return <AccountUnavailable message={`Your account is ${profile.accountStatus.toLowerCase()}. Contact support if you believe this is an error.`} />
  }
  if (error) return <AccountUnavailable message={error} />
  if (hasPendingStaffInvitation) return <Navigate to="/invitation-pending" replace />
  if (needsOnboarding) return <Navigate to="/onboarding" replace />
  if (membership?.status === 'invited') {
    return <AccountUnavailable message="Your staff invitation is awaiting activation. Sign out and use the setup link supplied by the business owner." />
  }
  if (membership?.status === 'suspended' || membership?.status === 'disabled') {
    return <AccountUnavailable message={`Your staff access is ${membership.status}. Contact the business owner for assistance.`} />
  }
  if (!membership) return <AccountUnavailable message="Your account does not have a valid business membership." />
  if (business?.accountStatus === 'SUSPENDED' || business?.accountStatus === 'CANCELLED') {
    return <AccountUnavailable message={`This business account is ${business.accountStatus.toLowerCase()}. Contact support for assistance.`} />
  }
  return children
}

export function PermissionRoute({ permission, children }: GuardProps & { permission: Permission }) {
  const { hasPermission } = useAuth()
  return hasPermission(permission) ? children : <Navigate to="/" replace />
}

export function OnboardingRoute({ children }: GuardProps) {
  const { user, profile, loading, error, needsOnboarding, hasPendingStaffInvitation } = useAuth()

  if (loading) return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  if (profile?.accountStatus === 'SUSPENDED' || profile?.accountStatus === 'CANCELLED') {
    return <AccountUnavailable message="This account cannot complete onboarding. Contact support for assistance." />
  }
  if (error) return <AccountUnavailable message={error} />
  if (hasPendingStaffInvitation) return <Navigate to="/invitation-pending" replace />
  if (!needsOnboarding) return <Navigate to="/" replace />
  return children
}

export function PendingInvitationRoute({ children }: GuardProps) {
  const { user, loading, error, needsOnboarding, hasPendingStaffInvitation } = useAuth()
  if (loading) return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  if (error) return <AccountUnavailable message={error} />
  if (!hasPendingStaffInvitation) return <Navigate to={needsOnboarding ? '/onboarding' : '/'} replace />
  return children
}

export function AdminRoute({ children }: GuardProps) {
  const { user, loading, isPlatformAdmin } = useAuth()

  if (loading) return <LoadingScreen />
  if (!user) return <Navigate to="/login" replace />
  if (!isPlatformAdmin) return <Navigate to="/" replace />
  return children
}
