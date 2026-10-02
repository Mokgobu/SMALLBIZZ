import {
  collection,
  documentId,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type Unsubscribe
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { requireFirebase } from '../config/firebase'
import { validateSaleRequest, validateTenantContext, ValidationError } from '../domain/commerce'
import type { CreateSaleResult, RecordSaleInput, Sale } from '../models/sale'
import { readPage, type PageCursor, type PageResult } from './tenant'

export type SalesRepository = {
  subscribe: (onData: (sales: Sale[]) => void, onError: (error: unknown) => void) => Unsubscribe
  listPage: (cursor?: PageCursor | null) => Promise<PageResult<Sale>>
  subscribeByCustomer: (customerId: string, onData: (sales: Sale[]) => void, onError: (error: unknown) => void) => Unsubscribe
  record: (input: RecordSaleInput) => Promise<CreateSaleResult>
}

export function createFirestoreSalesRepository(businessId: string, userId: string): SalesRepository {
  validateTenantContext(businessId, userId)
  const { db, functions } = requireFirebase()
  const salesRef = collection(db, 'businesses', businessId, 'sales')
  const callCreateSale = httpsCallable<RecordSaleInput, CreateSaleResult>(functions, 'createSale')

  return {
    listPage(cursor) {
      return readPage<Sale>(query(salesRef, orderBy('createdAt', 'desc'), orderBy(documentId(), 'desc')), cursor)
    },
    subscribe(onData, onError) {
      return onSnapshot(
        query(salesRef, orderBy('createdAt', 'desc'), limit(100)),
        (snapshot) => onData(snapshot.docs.map((sale) => ({ id: sale.id, ...sale.data() }) as Sale)),
        onError
      )
    },

    subscribeByCustomer(customerId, onData, onError) {
      if (!customerId) throw new ValidationError('Choose a customer.')
      return onSnapshot(
        query(salesRef, where('customerId', '==', customerId), orderBy('createdAt', 'desc'), limit(50)),
        (snapshot) => {
          const sales = snapshot.docs.map((sale) => ({ id: sale.id, ...sale.data() }) as Sale)
          onData(sales)
        },
        onError
      )
    },

    async record(input) {
      validateSaleRequest(input)
      const result = await callCreateSale(input)
      return result.data
    }
  }
}
