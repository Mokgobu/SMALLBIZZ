import {
  collection,
  getDocs,
  limit,
  query,
  startAfter,
  type CollectionReference,
  type DocumentData,
  type Firestore,
  type Query,
  type QueryDocumentSnapshot,
  type QuerySnapshot
} from 'firebase/firestore'
import { requireFirebase } from '../config/firebase'
import { validateTenantContext } from '../domain/commerce'

export function tenantCollection(businessId: string, userId: string, collectionName: string): {
  db: Firestore
  userId: string
  collectionRef: CollectionReference<DocumentData>
} {
  validateTenantContext(businessId, userId)
  const { db } = requireFirebase()
  return { db, userId, collectionRef: collection(db, 'businesses', businessId, collectionName) }
}

export function mapSnapshot<T extends { id: string }>(snapshot: QuerySnapshot<DocumentData>) {
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }) as T)
}

export type PageCursor = QueryDocumentSnapshot<DocumentData>

export type PageResult<T> = {
  items: T[]
  cursor: PageCursor | null
  hasMore: boolean
}

export async function readPage<T extends { id: string }>(
  baseQuery: Query<DocumentData>,
  cursor: PageCursor | null = null,
  pageSize = 40
): Promise<PageResult<T>> {
  const pageQuery = cursor
    ? query(baseQuery, startAfter(cursor), limit(pageSize + 1))
    : query(baseQuery, limit(pageSize + 1))
  const snapshot = await getDocs(pageQuery)
  const hasMore = snapshot.docs.length > pageSize
  const visible = hasMore ? snapshot.docs.slice(0, pageSize) : snapshot.docs
  return {
    items: visible.map((item) => ({ id: item.id, ...item.data() }) as T),
    cursor: visible.length ? visible[visible.length - 1] : null,
    hasMore
  }
}
