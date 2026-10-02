import { useEffect, useMemo, useState } from 'react'
import EmptyState from '../components/feedback/EmptyState'
import ErrorMessage from '../components/feedback/ErrorMessage'
import LoadingScreen from '../components/feedback/LoadingScreen'
import PageHeader from '../components/layout/PageHeader'
import { useAuth } from '../hooks/useAuth'
import { usePagedData } from '../hooks/usePagedData'
import type { BusinessMembership, InviteStaffInput, StaffInvitation, StaffRole, StaffStatus } from '../models/staff'
import { createFirestoreStaffRepository } from '../services/staff'
import { invitationFeedback, type LocalInvitationLinks } from '../staff/invitationFeedback'
import { getFirebaseErrorMessage } from '../utils/firebaseErrors'
import { formatDateTime } from '../utils/format'

const editableRoles: Array<Exclude<StaffRole, 'owner'>> = ['manager', 'supervisor', 'cashier']
const initialInvite: InviteStaffInput = { name: '', email: '', role: 'cashier' }

function statusClass(status: StaffStatus) {
  if (status === 'active') return 'bg-green-50 text-green-700'
  if (status === 'invited') return 'bg-blue-50 text-blue-700'
  if (status === 'suspended') return 'bg-amber-50 text-amber-800'
  return 'bg-red-50 text-red-700'
}

export default function Staff() {
  const { business, user, membership } = useAuth()
  const repository = useMemo(() => business && user ? createFirestoreStaffRepository(business.id, user.uid) : null, [business, user])
  const [members, setMembers] = useState<BusinessMembership[]>([])
  const [invitations, setInvitations] = useState<StaffInvitation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [localInvitationLinks, setLocalInvitationLinks] = useState<LocalInvitationLinks | null>(null)
  const [showInvite, setShowInvite] = useState(false)
  const [invite, setInvite] = useState<InviteStaffInput>(initialInvite)
  const [saving, setSaving] = useState<string | null>(null)
  const activity = usePagedData(repository ? repository.listActivityPage : null, 'Unable to load staff activity.')
  const visibleMembers = membership && !members.some((member) => member.uid === membership.uid)
    ? [membership, ...members]
    : members

  useEffect(() => {
    if (!repository) return
    return repository.subscribe(
      (nextMembers) => { setMembers(nextMembers); setLoading(false); setError(null) },
      (loadError) => { setError(getFirebaseErrorMessage(loadError, 'Unable to load staff.')); setLoading(false) }
    )
  }, [repository])

  useEffect(() => {
    if (!repository) return
    return repository.subscribeInvitations(setInvitations, (loadError) => setError(getFirebaseErrorMessage(loadError, 'Unable to load invitations.')))
  }, [repository])

  const submitInvite = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!repository) return
    setSaving('invite'); setError(null); setSuccess(null); setLocalInvitationLinks(null)
    try {
      const result = await repository.invite(invite)
      const feedback = invitationFeedback(result, 'invite')
      setSuccess(feedback.message)
      setLocalInvitationLinks(feedback.localLinks)
      setInvite(initialInvite)
      setShowInvite(false)
    } catch (inviteError) {
      setError(getFirebaseErrorMessage(inviteError, inviteError instanceof Error ? inviteError.message : 'Unable to invite staff.'))
    } finally { setSaving(null) }
  }

  const resendInvitation = async (invitation: StaffInvitation) => {
    if (!repository) return
    setSaving(invitation.id); setError(null); setSuccess(null); setLocalInvitationLinks(null)
    try {
      const result = await repository.resend(invitation.id)
      const feedback = invitationFeedback(result, 'resend')
      setSuccess(feedback.message)
      setLocalInvitationLinks(feedback.localLinks)
    } catch (resendError) { setError(getFirebaseErrorMessage(resendError, 'Unable to resend the invitation.')) }
    finally { setSaving(null) }
  }

  const copyLocalLink = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setError(null)
      setSuccess(`${label} copied.`)
    } catch {
      setError(`Unable to copy the ${label.toLowerCase()}. Copy it from the browser address bar or retry.`)
    }
  }

  const changeRole = async (member: BusinessMembership, role: Exclude<StaffRole, 'owner'>) => {
    if (!repository || role === member.role) return
    setSaving(member.uid); setError(null); setSuccess(null)
    try { await repository.updateRole(member.uid, role); setSuccess(`${member.displayName}'s role is now ${role}.`) }
    catch (updateError) { setError(getFirebaseErrorMessage(updateError, 'Unable to change the staff role.')) }
    finally { setSaving(null) }
  }

  const changeStatus = async (member: BusinessMembership, status: 'active' | 'suspended' | 'disabled') => {
    if (!repository) return
    setSaving(member.uid); setError(null); setSuccess(null)
    try { await repository.updateStatus(member.uid, status); setSuccess(`${member.displayName} is now ${status}.`) }
    catch (updateError) { setError(getFirebaseErrorMessage(updateError, 'Unable to change staff access.')) }
    finally { setSaving(null) }
  }

  if (loading) return <LoadingScreen message="Loading staff..." />

  return <main className="p-4 md:p-6"><div className="mx-auto max-w-7xl">
    <PageHeader title="Staff" description="Manage the people who share this business account." action={<button onClick={() => setShowInvite((open) => !open)} className="rounded bg-primary px-4 py-2 text-white">Add staff</button>} />
    {error && <ErrorMessage message={error} />}
    {success && <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700" role="status">{success}</div>}
    {localInvitationLinks && <section aria-label="Local invitation testing links" className="mb-4 rounded-md border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
      <h2 className="font-semibold">Local emulator testing</h2>
      <p className="mt-1">These links are held only in this browser session and were not emailed or stored in Firestore.</p>
      {localInvitationLinks.previousInvitationLinkInvalid && <p className="mt-1 font-medium">The previous invitation link is invalid. Use the replacement links below.</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => void copyLocalLink('Invitation link', localInvitationLinks.invitationUrl)} className="rounded border border-blue-300 bg-white px-3 py-2">Copy invitation link</button>
        <button type="button" onClick={() => void copyLocalLink('Password setup link', localInvitationLinks.passwordSetupUrl)} className="rounded border border-blue-300 bg-white px-3 py-2">Copy password setup link</button>
      </div>
    </section>}
    {showInvite && <form onSubmit={submitInvite} className="card mb-6"><h2 className="mb-4 text-lg font-semibold">Invite staff member</h2><div className="grid gap-4 md:grid-cols-3">
      <label><span className="text-sm">Name *</span><input value={invite.name} onChange={(event) => setInvite({ ...invite, name: event.target.value })} maxLength={100} required className="mt-1 w-full rounded border px-3 py-2" /></label>
      <label><span className="text-sm">Email *</span><input type="email" value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} required className="mt-1 w-full rounded border px-3 py-2" /></label>
      <label><span className="text-sm">Role *</span><select value={invite.role} onChange={(event) => setInvite({ ...invite, role: event.target.value as InviteStaffInput['role'] })} className="mt-1 w-full rounded border px-3 py-2">{editableRoles.map((role) => <option key={role} value={role}>{role[0].toUpperCase() + role.slice(1)}</option>)}</select></label>
    </div><div className="mt-4 flex gap-2"><button disabled={saving === 'invite'} className="rounded bg-primary px-4 py-2 text-white disabled:opacity-60">{saving === 'invite' ? 'Creating access...' : 'Create invitation'}</button><button type="button" onClick={() => setShowInvite(false)} className="rounded border px-4 py-2">Cancel</button></div></form>}

    {visibleMembers.length === 0 ? <EmptyState title="No staff found" description="The owner membership will appear here after migration or onboarding." /> : <div className="overflow-x-auto rounded-lg border bg-white"><table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Staff member</th><th className="p-3">Role</th><th className="p-3">Status</th><th className="p-3">Date added</th><th className="p-3">Recent activity</th><th className="p-3 text-right">Access</th></tr></thead><tbody>{visibleMembers.map((member) => {
      const isOwner = member.role === 'owner'
      const busy = saving === member.uid
      return <tr key={member.uid} className="border-t"><td className="p-3"><div className="font-medium">{member.displayName}</div><div className="text-xs text-slate-500">{member.email}</div></td><td className="p-3">{isOwner ? <span className="capitalize">{member.role}</span> : <select aria-label={`Role for ${member.displayName}`} disabled={busy} value={member.role} onChange={(event) => void changeRole(member, event.target.value as Exclude<StaffRole, 'owner'>)} className="rounded border px-2 py-1 capitalize">{editableRoles.map((role) => <option key={role} value={role}>{role}</option>)}</select>}</td><td className="p-3"><span className={`rounded-full px-2 py-1 text-xs font-medium capitalize ${statusClass(member.status)}`}>{member.status}</span></td><td className="p-3 text-slate-600">{formatDateTime(member.createdAt)}</td><td className="p-3 text-slate-600">{member.lastActiveAt ? formatDateTime(member.lastActiveAt) : member.status === 'invited' ? 'Awaiting first sign-in' : 'No activity yet'}</td><td className="p-3 text-right">{isOwner ? <span className="text-xs text-slate-500">Protected owner</span> : <div className="flex justify-end gap-2">{member.status !== 'active' && <button disabled={busy} onClick={() => void changeStatus(member, 'active')} className="text-primary underline disabled:opacity-50">Reactivate</button>}{member.status === 'active' && <button disabled={busy} onClick={() => void changeStatus(member, 'suspended')} className="text-amber-700 underline disabled:opacity-50">Suspend</button>}{member.status !== 'disabled' && <button disabled={busy} onClick={() => void changeStatus(member, 'disabled')} className="text-red-700 underline disabled:opacity-50">Disable</button>}</div>}</td></tr>
    })}</tbody></table></div>}

    <section className="mt-8"><h2 className="mb-3 text-lg font-semibold">Invitations</h2>{invitations.length === 0 ? <p className="text-sm text-slate-500">No invitations yet.</p> : <div className="overflow-x-auto rounded-lg border bg-white"><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Recipient</th><th className="p-3">Role</th><th className="p-3">Status</th><th className="p-3">Created</th><th className="p-3"></th></tr></thead><tbody>{invitations.map((invitation) => <tr className="border-t" key={invitation.id}><td className="p-3"><div className="font-medium">{invitation.displayName}</div><div className="text-xs text-slate-500">{invitation.invitedEmail}</div></td><td className="p-3 capitalize">{invitation.proposedRole}</td><td className="p-3 capitalize">{invitation.status.replace('_', ' ')}</td><td className="p-3 text-slate-600">{formatDateTime(invitation.createdAt)}</td><td className="p-3 text-right">{['sent', 'delivery_failed'].includes(invitation.status) && <button disabled={saving === invitation.id} onClick={() => void resendInvitation(invitation)} className="text-primary underline disabled:opacity-50">Resend</button>}</td></tr>)}</tbody></table></div>}</section>

    <section className="mt-8"><h2 className="mb-3 text-lg font-semibold">Staff activity</h2>{activity.error && <ErrorMessage message={activity.error} />}{activity.items.length === 0 ? <p className="text-sm text-slate-500">No staff activity recorded yet.</p> : <div className="space-y-2">{activity.items.map((item) => <article key={item.id} className="rounded-lg border bg-white p-3"><p className="text-sm">{item.description ?? `${item.actorName ?? 'A staff member'} performed ${item.type.replace(/_/g, ' ')}${item.targetName ? ` for ${item.targetName}` : ''}.`}</p><p className="mt-1 text-xs text-slate-500">{formatDateTime(item.createdAt)}</p></article>)}</div>}{activity.hasMore && <button onClick={() => void activity.loadMore()} disabled={activity.loadingMore} className="mt-3 rounded border px-4 py-2 text-sm disabled:opacity-50">{activity.loadingMore ? 'Loading...' : 'Load more activity'}</button>}</section>
  </div></main>
}
