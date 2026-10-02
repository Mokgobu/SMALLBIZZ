import { doc, documentId, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, type Unsubscribe } from 'firebase/firestore'
import { validateSupplierInput } from '../domain/records'
import { ValidationError } from '../domain/commerce'
import type { Supplier, SupplierInput } from '../models/supplier'
import { mapSnapshot, readPage, tenantCollection, type PageCursor, type PageResult } from './tenant'

export type SupplierRepository = {
  subscribe: (onData: (suppliers: Supplier[]) => void, onError: (error: unknown) => void) => Unsubscribe
  listPage: (cursor?: PageCursor | null) => Promise<PageResult<Supplier>>
  create: (input: SupplierInput) => Promise<string>
  update: (id: string, input: SupplierInput) => Promise<void>
  archive: (id: string) => Promise<void>
}

export function createFirestoreSupplierRepository(businessId: string, userId: string): SupplierRepository {
  const { collectionRef } = tenantCollection(businessId, userId, 'suppliers')
  return {
    listPage(cursor) {
      return readPage<Supplier>(query(collectionRef, orderBy('name'), orderBy(documentId())), cursor)
    },
    subscribe(onData, onError) {
      return onSnapshot(query(collectionRef, orderBy('name')), (snapshot) => onData(mapSnapshot<Supplier>(snapshot)), onError)
    },
    async create(input) {
      const supplierRef = doc(collectionRef)
      await setDoc(supplierRef, {
        ...validateSupplierInput(input), status: 'active', createdBy: userId,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      })
      return supplierRef.id
    },
    async update(id, input) {
      if (!id) throw new ValidationError('Choose a supplier to update.')
      await updateDoc(doc(collectionRef, id), { ...validateSupplierInput(input), updatedAt: serverTimestamp() })
    },
    async archive(id) {
      if (!id) throw new ValidationError('Choose a supplier to archive.')
      await updateDoc(doc(collectionRef, id), { status: 'archived', updatedAt: serverTimestamp() })
    }
  }
}
