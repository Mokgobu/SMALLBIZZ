import { useEffect, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import ErrorMessage from '../components/feedback/ErrorMessage'
import LoadingScreen from '../components/feedback/LoadingScreen'
import { requireFirebase } from '../config/firebase'
import { useAuth } from '../hooks/useAuth'
import { getFirebaseErrorMessage } from '../utils/firebaseErrors'

type InvitationPreview = { invitationId: string; businessName: string; inviterName: string; displayName: string; invitedEmail: string; proposedRole: string; status: 'sent' | 'accepted' | 'declined' | 'expired'; expiresAt: number }

export default function StaffInvitation() {
  const { user, business, membership, loading: authLoading, logout } = useAuth()
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const location = useLocation()
  const navigate = useNavigate()
  const [invitation, setInvitation] = useState<InvitationPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [awaitingAccess, setAwaitingAccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (authLoading) return
    if (!user || !token) { setLoading(false); return }
    const call = httpsCallable<{ token: string }, InvitationPreview>(requireFirebase().functions, 'getStaffInvitation')
    void call({ token }).then((result) => { setInvitation(result.data); setError(null) })
      .catch((reason) => setError(getFirebaseErrorMessage(reason, 'This invitation is invalid or no longer available.')))
      .finally(() => setLoading(false))
  }, [authLoading, token, user])

  useEffect(() => {
    if (!awaitingAccess) return
    if (membership?.status === 'active' && business) {
      navigate('/', { replace: true })
      return
    }
    const timeout = window.setTimeout(() => {
      setAwaitingAccess(false)
      setError('Your invitation was accepted, but SmallBizz could not verify the new business membership yet. Refresh the page or sign in again.')
    }, 20_000)
    return () => window.clearTimeout(timeout)
  }, [awaitingAccess, business, membership, navigate])

  const respond = async (action: 'accept' | 'decline') => {
    if (!token) return
    setSaving(true); setError(null)
    try {
      const call = httpsCallable<{ token: string }, { status: string }>(requireFirebase().functions, action === 'accept' ? 'acceptStaffInvitation' : 'declineStaffInvitation')
      await call({ token })
      if (action === 'accept') setAwaitingAccess(true)
      else setInvitation((current) => current ? { ...current, status: 'declined' } : current)
    } catch (reason) { setError(getFirebaseErrorMessage(reason, `Unable to ${action} this invitation.`)) }
    finally { setSaving(false) }
  }

  if (authLoading || loading) return <LoadingScreen message="Checking invitation..." />
  if (awaitingAccess) return <LoadingScreen message="Activating your business access..." />
  if (!token) return <main className="mx-auto max-w-lg p-6"><ErrorMessage message="The invitation link is missing its token." /></main>
  if (!user) return <main className="flex min-h-screen items-center justify-center p-4"><section className="card w-full max-w-lg"><h1 className="text-2xl font-semibold">Staff invitation</h1><p className="mt-3 text-slate-600">Sign in with the email address that received this invitation. New staff should first use the password setup link in the same email.</p><Link to="/login" state={{ from: { pathname: location.pathname, search: location.search } }} className="mt-5 inline-block rounded bg-primary px-4 py-2 text-white">Sign in to continue</Link></section></main>
  if (error || !invitation) return <main className="mx-auto max-w-lg p-6">{error && <ErrorMessage message={error} />}<button onClick={() => void logout()} className="mt-3 text-sm text-primary underline">Sign out and use another account</button></main>

  return <main className="flex min-h-screen items-center justify-center p-4"><section className="card w-full max-w-lg"><p className="text-sm font-medium text-primary">SmallBizz</p><h1 className="mt-2 text-2xl font-semibold">Join {invitation.businessName}</h1><p className="mt-3 text-slate-600">{invitation.inviterName} invited {invitation.invitedEmail} to join as <span className="font-medium capitalize">{invitation.proposedRole}</span>.</p><p className="mt-2 text-xs text-slate-500">Expires {new Date(invitation.expiresAt).toLocaleString()}</p>{invitation.status === 'sent' ? <div className="mt-6 flex gap-3"><button disabled={saving} onClick={() => void respond('accept')} className="rounded bg-primary px-4 py-2 text-white disabled:opacity-60">{saving ? 'Saving...' : 'Accept invitation'}</button><button disabled={saving} onClick={() => void respond('decline')} className="rounded border px-4 py-2 disabled:opacity-60">Decline</button></div> : <p className="mt-5 rounded bg-slate-50 p-3 text-sm capitalize">This invitation has been {invitation.status}.</p>}</section></main>
}
