import { collection, documentId, onSnapshot, orderBy, query, type Unsubscribe } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { requireFirebase } from '../config/firebase'
import type { BusinessMembership, InviteStaffInput, InviteStaffResult, StaffActivity, StaffInvitation, StaffRole, StaffStatus } from '../models/staff'
import { validateTenantContext } from '../domain/commerce'
import { readPage, type PageCursor, type PageResult } from './tenant'

export type StaffRepository = {
  subscribe: (onData: (members: BusinessMembership[]) => void, onError: (error: unknown) => void) => Unsubscribe
  invite: (input: InviteStaffInput) => Promise<InviteStaffResult>
  resend: (invitationId: string) => Promise<InviteStaffResult>
  subscribeInvitations: (onData: (invitations: StaffInvitation[]) => void, onError: (error: unknown) => void) => Unsubscribe
  listActivityPage: (cursor?: PageCursor | null) => Promise<PageResult<StaffActivity>>
  updateRole: (uid: string, role: Exclude<StaffRole, 'owner'>) => Promise<void>
  updateStatus: (uid: string, status: Extract<StaffStatus, 'active' | 'suspended' | 'disabled'>) => Promise<void>
}

export function createFirestoreStaffRepository(businessId: string, userId: string): StaffRepository {
  validateTenantContext(businessId, userId)
  const { db, functions } = requireFirebase()
  const membersRef = collection(db, 'businesses', businessId, 'members')
  const invitationsRef = collection(db, 'businesses', businessId, 'staffInvitations')
  const activityRef = collection(db, 'businesses', businessId, 'staffActivity')
  const inviteStaff = httpsCallable<InviteStaffInput, InviteStaffResult>(functions, 'inviteStaff')
  const resendStaffInvite = httpsCallable<{ invitationId: string }, InviteStaffResult>(functions, 'resendStaffInvite')
  const updateStaffRole = httpsCallable<{ uid: string; role: Exclude<StaffRole, 'owner'> }, { ok: true }>(functions, 'updateStaffRole')
  const updateStaffStatus = httpsCallable<{ uid: string; status: Extract<StaffStatus, 'active' | 'suspended' | 'disabled'> }, { ok: true }>(functions, 'updateStaffStatus')

  return {
    subscribe(onData, onError) {
      return onSnapshot(
        query(membersRef, orderBy('createdAt', 'asc')),
        (snapshot) => onData(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as BusinessMembership)),
        onError
      )
    },
    async invite(input) {
      return (await inviteStaff(input)).data
    },
    async resend(invitationId) {
      return (await resendStaffInvite({ invitationId })).data
    },
    subscribeInvitations(onData, onError) {
      return onSnapshot(query(invitationsRef, orderBy('createdAt', 'desc')), (snapshot) => {
        onData(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as StaffInvitation))
      }, onError)
    },
    listActivityPage(cursor) {
      return readPage<StaffActivity>(query(activityRef, orderBy('createdAt', 'desc'), orderBy(documentId(), 'desc')), cursor)
    },
    async updateRole(uid, role) {
      await updateStaffRole({ uid, role })
    },
    async updateStatus(uid, status) {
      await updateStaffStatus({ uid, status })
    }
  }
}
