import type { InventoryMovement, InventoryMovementType, ManualInventoryMovementType } from '../models/inventory'
import { PAYMENT_METHODS, type RecordSaleInput, type SaleItem } from '../models/sale'
import type { Product, ProductInput, ProductStockStatus } from '../models/product'

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export const MAX_SALE_DISCOUNT_RATE = 0.2

function toCents(value: number) {
  return Math.round(value * 100)
}

function fromCents(value: number) {
  return value / 100
}

function requireNonNegativeMoney(value: number, field: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new ValidationError(`${field} must be a valid non-negative amount.`)
  }
  return fromCents(toCents(value))
}

function requireStockQuantity(value: number, field: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new ValidationError(`${field} must be a non-negative number.`)
  }
  return Number(value.toFixed(6))
}

export function validateTenantContext(businessId: string, userId: string) {
  if (!businessId.trim() || !userId.trim()) {
    throw new ValidationError('A valid authenticated business account is required.')
  }
}

export function validateProductInput(input: ProductInput): ProductInput {
  const name = input.name.trim()
  if (!name) throw new ValidationError('Product name is required.')
  const expiryWarningDays = Math.floor(requireStockQuantity(input.expiryWarningDays ?? 7, 'Expiry warning days'))
  const expiryCriticalDays = Math.floor(requireStockQuantity(input.expiryCriticalDays ?? 3, 'Expiry critical days'))
  if (expiryCriticalDays > expiryWarningDays) throw new ValidationError('Expiry critical days cannot exceed warning days.')

  const productClass = input.productClass ?? (input.menuItem ? 'menu_item' : input.isIngredient ? 'ingredient' : 'inventory_item')

  return {
    name,
    description: input.description.trim(),
    sku: input.sku.trim(),
    barcode: input.barcode.trim(),
    category: input.category.trim(),
    sellingPrice: requireNonNegativeMoney(input.sellingPrice, 'Selling price'),
    costPrice: requireNonNegativeMoney(input.costPrice, 'Cost price'),
    quantity: input.trackStock ? requireStockQuantity(input.quantity, 'Opening stock') : 0,
    reorderLevel: input.trackStock ? requireStockQuantity(input.reorderLevel, 'Reorder level') : 0,
    trackStock: Boolean(input.trackStock),
    tracksExpiry: Boolean(input.trackStock && input.tracksExpiry),
    shelfLifeDays: input.tracksExpiry && input.shelfLifeDays != null ? Math.floor(requireStockQuantity(input.shelfLifeDays, 'Shelf life')) : null,
    expiryWarningDays,
    expiryCriticalDays,
    unit: input.unit.trim() || 'item',
    productClass,
    menuItem: Boolean(input.menuItem),
    recipeId: input.recipeId ?? null,
    isIngredient: Boolean(input.isIngredient)
  }
}

export function getProductStockStatus(product: Pick<Product, 'trackStock' | 'quantity' | 'reorderLevel'>): ProductStockStatus {
  if (!product.trackStock) return 'not_tracked'
  if (product.quantity === 0) return 'out_of_stock'
  if (product.quantity <= product.reorderLevel) return 'low_stock'
  return 'in_stock'
}

export function calculateStockAdjustment(
  quantityBefore: number,
  type: ManualInventoryMovementType,
  enteredQuantity: number
) {
  requireStockQuantity(quantityBefore, 'Current stock')
  if (!Number.isFinite(enteredQuantity) || enteredQuantity === 0) {
    throw new ValidationError('Stock change must be a non-zero number.')
  }

  let quantityChange: number
  if (type === 'stock_in' || type === 'return') quantityChange = Math.abs(enteredQuantity)
  else if (type === 'stock_out' || type === 'damaged' || type === 'expired') quantityChange = -Math.abs(enteredQuantity)
  else quantityChange = enteredQuantity

  const quantityAfter = quantityBefore + quantityChange
  if (quantityAfter < 0) throw new ValidationError('This change would make stock negative.')

  return { quantityChange, quantityAfter }
}

export function buildInventoryMovement(
  product: Pick<Product, 'id' | 'name'>,
  type: InventoryMovementType,
  quantityBefore: number,
  quantityAfter: number,
  reason: string,
  referenceId: string | null,
  createdBy: string
): Omit<InventoryMovement, 'id' | 'createdAt'> {
  if (!reason.trim()) throw new ValidationError('An inventory movement reason is required.')
  const quantityChange = quantityAfter - quantityBefore
  if (!Number.isFinite(quantityBefore) || !Number.isFinite(quantityAfter) || quantityAfter < 0 || quantityChange === 0) {
    throw new ValidationError('Inventory movement quantities are invalid.')
  }
  return {
    productId: product.id,
    productName: product.name,
    type,
    quantityChange,
    quantityBefore,
    quantityAfter,
    reason: reason.trim(),
    referenceId,
    createdBy
  }
}

export function validateSaleRequest(input: RecordSaleInput) {
  if (!PAYMENT_METHODS.includes(input.paymentMethod)) {
    throw new ValidationError('Choose a valid payment method.')
  }
  if (input.items.length === 0) throw new ValidationError('Add at least one product to the sale.')
  requireNonNegativeMoney(input.discount, 'Discount')
  for (const line of input.items) {
    if (!line.productId.trim()) throw new ValidationError('Each sale line needs a product.')
    if (!Number.isInteger(line.quantity) || line.quantity <= 0) {
      throw new ValidationError('Sale quantities must be positive whole numbers.')
    }
    if (line.modifierOptionIds && (line.modifierOptionIds.length > 20 || new Set(line.modifierOptionIds).size !== line.modifierOptionIds.length)) throw new ValidationError('Selected modifiers are invalid.')
    if ((line.preparationNotes ?? '').trim().length > 200) throw new ValidationError('Preparation notes must be 200 characters or fewer.')
  }
}

export function prepareSale(products: Product[], input: RecordSaleInput) {
  validateSaleRequest(input)

  const productsById = new Map(products.map((product) => [product.id, product]))
  const combined = new Map<string, number>()
  for (const line of input.items) {
    combined.set(line.productId, (combined.get(line.productId) ?? 0) + line.quantity)
  }

  let subtotalCents = 0
  let costCents = 0
  const stockUpdates: Array<{ product: Product; quantityBefore: number; quantityAfter: number }> = []
  const items: SaleItem[] = []

  for (const [productId, quantity] of combined) {
    const product = productsById.get(productId)
    if (!product || product.status !== 'active') {
      throw new ValidationError('A selected product is unavailable. Refresh and try again.')
    }
    if (!Number.isFinite(product.sellingPrice) || product.sellingPrice < 0 || !Number.isFinite(product.costPrice) || product.costPrice < 0) {
      throw new ValidationError(`${product.name} has invalid pricing and cannot be sold.`)
    }
    if (product.trackStock && (!Number.isFinite(product.quantity) || product.quantity < 0)) {
      throw new ValidationError(`${product.name} has an invalid stock balance.`)
    }
    if (product.trackStock && product.quantity < quantity) {
      throw new ValidationError(`Insufficient stock for ${product.name}. Available: ${product.quantity}.`)
    }

    const lineCents = toCents(product.sellingPrice) * quantity
    subtotalCents += lineCents
    costCents += toCents(product.costPrice) * quantity
    items.push({
      productId,
      productName: product.name,
      sku: product.sku,
      quantity,
      unitPrice: fromCents(toCents(product.sellingPrice)),
      costPrice: fromCents(toCents(product.costPrice)),
      lineTotal: fromCents(lineCents)
    })

    if (product.trackStock) {
      stockUpdates.push({
        product,
        quantityBefore: product.quantity,
        quantityAfter: product.quantity - quantity
      })
    }
  }

  const discountCents = toCents(requireNonNegativeMoney(input.discount, 'Discount'))
  if (discountCents > subtotalCents) throw new ValidationError('Discount cannot exceed the subtotal.')
  if (discountCents > Math.floor(subtotalCents * MAX_SALE_DISCOUNT_RATE)) {
    throw new ValidationError(`Discount cannot exceed ${MAX_SALE_DISCOUNT_RATE * 100}% of the subtotal.`)
  }
  const totalCents = subtotalCents - discountCents

  return {
    items,
    stockUpdates,
    itemCount: items.reduce((total, item) => total + item.quantity, 0),
    subtotal: fromCents(subtotalCents),
    discount: fromCents(discountCents),
    total: fromCents(totalCents),
    grossProfit: fromCents(totalCents - costCents),
    paymentMethod: input.paymentMethod,
    notes: input.notes.trim()
  }
}
