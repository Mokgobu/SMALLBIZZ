import { doc, documentId, onSnapshot, orderBy, query, serverTimestamp, setDoc, updateDoc, type Unsubscribe } from 'firebase/firestore'
import { validateCustomerInput } from '../domain/records'
import { ValidationError } from '../domain/commerce'
import type { Customer, CustomerInput } from '../models/customer'
import { mapSnapshot, readPage, tenantCollection, type PageCursor, type PageResult } from './tenant'

export type CustomerRepository = {
  subscribe: (onData: (customers: Customer[]) => void, onError: (error: unknown) => void) => Unsubscribe
  listPage: (cursor?: PageCursor | null) => Promise<PageResult<Customer>>
  create: (input: CustomerInput) => Promise<string>
  update: (id: string, input: CustomerInput) => Promise<void>
  archive: (id: string) => Promise<void>
}

export function createFirestoreCustomerRepository(businessId: string, userId: string): CustomerRepository {
  const { collectionRef } = tenantCollection(businessId, userId, 'customers')
  return {
    listPage(cursor) {
      return readPage<Customer>(query(collectionRef, orderBy('displayName'), orderBy(documentId())), cursor)
    },
    subscribe(onData, onError) {
      return onSnapshot(query(collectionRef, orderBy('displayName')), (snapshot) => onData(mapSnapshot<Customer>(snapshot)), onError)
    },
    async create(input) {
      const customerRef = doc(collectionRef)
      await setDoc(customerRef, {
        ...validateCustomerInput(input), status: 'active', createdBy: userId,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      })
      return customerRef.id
    },
    async update(id, input) {
      if (!id) throw new ValidationError('Choose a customer to update.')
      await updateDoc(doc(collectionRef, id), { ...validateCustomerInput(input), updatedAt: serverTimestamp() })
    },
    async archive(id) {
      if (!id) throw new ValidationError('Choose a customer to archive.')
      await updateDoc(doc(collectionRef, id), { status: 'archived', updatedAt: serverTimestamp() })
    }
  }
}
