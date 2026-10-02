import {
  collection,
  doc,
  documentId,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  type Unsubscribe
} from 'firebase/firestore'
import { requireFirebase } from '../config/firebase'
import { buildInventoryMovement, calculateStockAdjustment, validateTenantContext, ValidationError } from '../domain/commerce'
import type { InventoryMovement, StockAdjustmentInput } from '../models/inventory'
import type { Product } from '../models/product'
import { readPage, type PageCursor, type PageResult } from './tenant'

export type InventoryRepository = {
  subscribeMovements: (
    onData: (movements: InventoryMovement[]) => void,
    onError: (error: unknown) => void
  ) => Unsubscribe
  listMovementPage: (cursor?: PageCursor | null) => Promise<PageResult<InventoryMovement>>
  adjustStock: (input: StockAdjustmentInput) => Promise<void>
}

export function createFirestoreInventoryRepository(businessId: string, userId: string): InventoryRepository {
  validateTenantContext(businessId, userId)
  const { db } = requireFirebase()
  const productsRef = collection(db, 'businesses', businessId, 'products')
  const movementsRef = collection(db, 'businesses', businessId, 'inventoryMovements')

  return {
    listMovementPage(cursor) {
      return readPage<InventoryMovement>(query(movementsRef, orderBy('createdAt', 'desc'), orderBy(documentId(), 'desc')), cursor)
    },
    subscribeMovements(onData, onError) {
      return onSnapshot(
        query(movementsRef, orderBy('createdAt', 'desc'), limit(200)),
        (snapshot) => onData(snapshot.docs.map((movement) => ({ id: movement.id, ...movement.data() }) as InventoryMovement)),
        onError
      )
    },

    async adjustStock(input) {
      if (!input.productId) throw new ValidationError('Choose a product.')
      if (!input.reason.trim()) throw new ValidationError('A reason is required for every stock adjustment.')

      const productRef = doc(productsRef, input.productId)
      const movementRef = doc(movementsRef)

      await runTransaction(db, async (transaction) => {
        const snapshot = await transaction.get(productRef)
        if (!snapshot.exists()) throw new ValidationError('The selected product no longer exists.')

        const product = { id: snapshot.id, ...snapshot.data() } as Product
        if (product.status !== 'active') throw new ValidationError('Archived products cannot be adjusted.')
        if (!product.trackStock) throw new ValidationError('Stock tracking is disabled for this product.')

        const { quantityAfter } = calculateStockAdjustment(
          product.quantity,
          input.type,
          input.quantity
        )
        const movement = buildInventoryMovement(
          product, input.type, product.quantity, quantityAfter, input.reason, null, userId
        )

        transaction.update(productRef, {
          quantity: quantityAfter,
          lastMovementId: movementRef.id,
          updatedAt: serverTimestamp()
        })
        transaction.set(movementRef, {
          ...movement,
          createdAt: serverTimestamp(),
        })
      })
    }
  }
}
