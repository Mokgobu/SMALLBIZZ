import {
  collection,
  doc,
  documentId,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type Unsubscribe
} from 'firebase/firestore'
import { requireFirebase } from '../config/firebase'
import { buildInventoryMovement, validateProductInput, validateTenantContext } from '../domain/commerce'
import type { Product, ProductInput, ProductStatus } from '../models/product'
import { readPage, type PageCursor, type PageResult } from './tenant'

export type ProductRepository = {
  subscribe: (onData: (products: Product[]) => void, onError: (error: unknown) => void) => Unsubscribe
  listPage: (cursor?: PageCursor | null) => Promise<PageResult<Product>>
  create: (input: ProductInput) => Promise<string>
  update: (productId: string, input: ProductInput) => Promise<void>
  setStatus: (productId: string, status: ProductStatus) => Promise<void>
}

export function createFirestoreProductRepository(businessId: string, userId: string): ProductRepository {
  validateTenantContext(businessId, userId)
  const { db } = requireFirebase()
  const productsRef = collection(db, 'businesses', businessId, 'products')
  const movementsRef = collection(db, 'businesses', businessId, 'inventoryMovements')

  return {
    listPage(cursor) {
      return readPage<Product>(query(productsRef, orderBy('name'), orderBy(documentId())), cursor)
    },
    subscribe(onData, onError) {
      return onSnapshot(
        query(productsRef, orderBy('name')),
        (snapshot) => onData(snapshot.docs.map((product) => ({ id: product.id, ...product.data() }) as Product)),
        onError
      )
    },

    async create(input) {
      const product = validateProductInput(input)
      const productRef = doc(productsRef)
      const movementRef = product.trackStock && product.quantity > 0 ? doc(movementsRef) : null
      const batch = writeBatch(db)

      batch.set(productRef, {
        ...product,
        status: 'active',
        lastMovementId: movementRef?.id ?? null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        createdBy: userId
      })

      if (movementRef) {
        const movement = buildInventoryMovement(
          { id: productRef.id, name: product.name }, 'opening_stock', 0,
          product.quantity, 'Opening stock', null, userId
        )
        batch.set(movementRef, {
          ...movement,
          createdAt: serverTimestamp(),
        })
      }

      await batch.commit()
      return productRef.id
    },

    async update(productId, input) {
      if (!productId) throw new Error('A product is required.')
      const product = validateProductInput(input)
      const { quantity: _ignoredQuantity, ...editableProduct } = product
      await updateDoc(doc(productsRef, productId), {
        ...editableProduct,
        updatedAt: serverTimestamp()
      })
    },

    async setStatus(productId, status) {
      if (!productId) throw new Error('A product is required.')
      await updateDoc(doc(productsRef, productId), {
        status,
        updatedAt: serverTimestamp()
      })
    }
  }
}
