import { collection, doc, documentId, getDoc, onSnapshot, orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc, type Unsubscribe } from 'firebase/firestore'
import { validateExpenseInput } from '../domain/records'
import { ValidationError } from '../domain/commerce'
import type { Expense, ExpenseInput } from '../models/expense'
import type { Supplier } from '../models/supplier'
import { mapSnapshot, readPage, tenantCollection, type PageCursor, type PageResult } from './tenant'

export type ExpenseRepository = {
  subscribe: (onData: (expenses: Expense[]) => void, onError: (error: unknown) => void) => Unsubscribe
  listPage: (cursor?: PageCursor | null) => Promise<PageResult<Expense>>
  create: (input: ExpenseInput) => Promise<string>
  update: (id: string, input: ExpenseInput) => Promise<void>
  archive: (id: string) => Promise<void>
}

export function createFirestoreExpenseRepository(businessId: string, userId: string): ExpenseRepository {
  const { db, collectionRef } = tenantCollection(businessId, userId, 'expenses')
  const suppliersRef = collection(db, 'businesses', businessId, 'suppliers')

  const supplierSnapshot = async (supplierId: string | null) => {
    if (!supplierId) return null
    const snapshot = await getDoc(doc(suppliersRef, supplierId))
    if (!snapshot.exists()) throw new ValidationError('The selected supplier no longer exists.')
    const supplier = { id: snapshot.id, ...snapshot.data() } as Supplier
    if (supplier.status !== 'active') throw new ValidationError('Choose an active supplier.')
    return supplier
  }

  const expenseData = async (input: ExpenseInput, existing?: Expense) => {
    const valid = validateExpenseInput(input)
    const supplier = existing && existing.supplierId === valid.supplierId
      ? null
      : await supplierSnapshot(valid.supplierId)
    return {
      ...valid,
      expenseDate: Timestamp.fromDate(new Date(`${valid.expenseDate}T12:00:00Z`)),
      supplierNameSnapshot: supplier?.name ?? (valid.supplierId ? existing?.supplierNameSnapshot ?? null : null)
    }
  }

  return {
    listPage(cursor) {
      return readPage<Expense>(query(collectionRef, orderBy('expenseDate', 'desc'), orderBy(documentId(), 'desc')), cursor)
    },
    subscribe(onData, onError) {
      return onSnapshot(query(collectionRef, orderBy('expenseDate', 'desc')), (snapshot) => onData(mapSnapshot<Expense>(snapshot)), onError)
    },
    async create(input) {
      const expenseRef = doc(collectionRef)
      await setDoc(expenseRef, {
        ...await expenseData(input), status: 'active', createdBy: userId,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      })
      return expenseRef.id
    },
    async update(id, input) {
      if (!id) throw new ValidationError('Choose an expense to update.')
      const expenseRef = doc(collectionRef, id)
      const snapshot = await getDoc(expenseRef)
      if (!snapshot.exists()) throw new ValidationError('The selected expense no longer exists.')
      const existing = { id: snapshot.id, ...snapshot.data() } as Expense
      await updateDoc(expenseRef, { ...await expenseData(input, existing), updatedAt: serverTimestamp() })
    },
    async archive(id) {
      if (!id) throw new ValidationError('Choose an expense to archive.')
      await updateDoc(doc(collectionRef, id), { status: 'archived', updatedAt: serverTimestamp() })
    }
  }
}
