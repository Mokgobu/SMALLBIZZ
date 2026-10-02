export const PAYMENT_METHODS = ['cash', 'card', 'eft', 'mobile', 'other'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]
export const MAX_DISCOUNT_RATE = 0.2

export class SaleInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SaleInputError'
  }
}

export type SaleIntent = {
  items: Array<{ productId: string; quantity: number; modifierOptionIds: string[]; preparationNotes: string }>
  customerId: string | null
  discount: number
  promotionId: string | null
  paymentMethod: PaymentMethod
  notes: string
}

export type AuthoritativeProduct = {
  id: string
  name: string
  sku: string
  sellingPrice: number
  costPrice: number
  quantity: number
  trackStock: boolean
  status: string
  category?: string
  tracksExpiry?: boolean
  productClass?: string
  menuItem?: boolean
  recipeId?: string | null
  isIngredient?: boolean
  unit?: string
}

const intentKeys = new Set(['items', 'customerId', 'discount', 'promotionId', 'paymentMethod', 'notes'])
const itemKeys = new Set(['productId', 'quantity', 'modifierOptionIds', 'preparationNotes'])

function assertPlainObject(value: unknown, message: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SaleInputError(message)
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: Set<string>) {
  const unsupported = Object.keys(value).find((key) => !allowed.has(key))
  if (unsupported) throw new SaleInputError(`Unsupported sale field: ${unsupported}.`)
}

function cents(value: number, field: string) {
  if (!Number.isFinite(value) || value < 0) throw new SaleInputError(`${field} must be a valid non-negative amount.`)
  const rounded = Math.round(value * 100)
  if (!Number.isSafeInteger(rounded)) throw new SaleInputError(`${field} is too large.`)
  return rounded
}

const money = (value: number) => Math.round(value) / 100

export function validateSaleIntent(data: unknown): SaleIntent {
  assertPlainObject(data, 'Sale details are required.')
  assertOnlyKeys(data, intentKeys)
  if (!Array.isArray(data.items) || data.items.length === 0 || data.items.length > 100) {
    throw new SaleInputError('Add between 1 and 100 sale lines.')
  }
  const combined = new Map<string, SaleIntent['items'][number]>()
  for (const rawLine of data.items) {
    assertPlainObject(rawLine, 'Each sale line must contain a product and quantity.')
    assertOnlyKeys(rawLine, itemKeys)
    const productId = typeof rawLine.productId === 'string' ? rawLine.productId.trim() : ''
    const quantity = rawLine.quantity
    if (!productId || productId.length > 200) throw new SaleInputError('Each sale line needs a valid product.')
    if (!Number.isInteger(quantity) || (quantity as number) <= 0 || (quantity as number) > 100000) {
      throw new SaleInputError('Sale quantities must be positive whole numbers.')
    }
    const modifierOptionIds = rawLine.modifierOptionIds === undefined ? [] : rawLine.modifierOptionIds
    if (!Array.isArray(modifierOptionIds) || modifierOptionIds.length > 20 || modifierOptionIds.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,150}$/.test(id))) throw new SaleInputError('Selected modifiers are invalid.')
    const preparationNotes = rawLine.preparationNotes === undefined ? '' : rawLine.preparationNotes
    if (typeof preparationNotes !== 'string' || preparationNotes.trim().length > 200) throw new SaleInputError('Preparation notes must be 200 characters or fewer.')
    const normalizedOptions = modifierOptionIds.map((id) => id.trim())
    const signature = `${productId}|${[...normalizedOptions].sort().join(',')}|${preparationNotes.trim()}`
    const combinedQuantity = (combined.get(signature)?.quantity ?? 0) + (quantity as number)
    if (!Number.isSafeInteger(combinedQuantity) || combinedQuantity > 100000) throw new SaleInputError('A sale quantity is too large.')
    combined.set(signature, { productId, quantity: combinedQuantity, modifierOptionIds: normalizedOptions, preparationNotes: preparationNotes.trim() })
  }

  const paymentMethod = data.paymentMethod
  if (typeof paymentMethod !== 'string' || !PAYMENT_METHODS.includes(paymentMethod as PaymentMethod)) {
    throw new SaleInputError('Choose a valid payment method.')
  }
  const discount = data.discount === undefined ? 0 : data.discount
  if (typeof discount !== 'number') throw new SaleInputError('Discount must be a number.')
  cents(discount, 'Discount')
  const customerId = data.customerId === undefined || data.customerId === null || data.customerId === ''
    ? null
    : typeof data.customerId === 'string' ? data.customerId.trim() : ''
  if (data.customerId != null && data.customerId !== '' && (!customerId || customerId.length > 200)) {
    throw new SaleInputError('Choose a valid customer.')
  }
  const promotionId = data.promotionId === undefined || data.promotionId === null || data.promotionId === '' ? null : typeof data.promotionId === 'string' ? data.promotionId.trim() : ''
  if (data.promotionId != null && data.promotionId !== '' && (!promotionId || promotionId.length > 150)) throw new SaleInputError('Choose a valid promotion.')
  const notes = data.notes === undefined ? '' : data.notes
  if (typeof notes !== 'string' || notes.trim().length > 500) throw new SaleInputError('Sale notes must be 500 characters or fewer.')

  return {
    items: [...combined.values()],
    customerId,
    discount: money(cents(discount, 'Discount')),
    promotionId,
    paymentMethod: paymentMethod as PaymentMethod,
    notes: notes.trim()
  }
}

export type AuthoritativeLineAdjustment = { unitPriceDelta?: number; unitCostOverride?: number; modifierSnapshots?: Array<{ id: string; label: string; priceDelta: number }>; recipeSnapshot?: { recipeId: string; version: number; nameSnapshot: string; ingredients: unknown[] } | null; menuItem?: boolean }

export function prepareAuthoritativeSale(products: AuthoritativeProduct[], intent: SaleIntent, options: { manualDiscountLimitRate?: number; promotionDiscount?: number; lineAdjustments?: AuthoritativeLineAdjustment[] } = {}) {
  const productsById = new Map(products.map((product) => [product.id, product]))
  let subtotalCents = 0
  let cogsCents = 0
  let unitsSold = 0
  const items = [] as Array<{
    productId: string
    productName: string
    sku: string
    quantity: number
    unitPrice: number
    costPrice: number
    lineTotal: number
    modifiers: Array<{ id: string; label: string; priceDelta: number }>
    preparationNotes: string
    recipeSnapshot: AuthoritativeLineAdjustment['recipeSnapshot']
    menuItem: boolean
  }>
  const stockUpdates = [] as Array<{ product: AuthoritativeProduct; quantityBefore: number; quantityAfter: number }>
  const stockQuantities = new Map<string, number>()

  for (const [lineIndex, line] of intent.items.entries()) {
    const product = productsById.get(line.productId)
    if (!product) throw new SaleInputError('A selected product does not exist in this business.')
    if (product.status !== 'active') throw new SaleInputError(`${product.name || 'A selected product'} is not active.`)
    const adjustment = options.lineAdjustments?.[lineIndex]
    const unitPriceCents = cents(product.sellingPrice + Number(adjustment?.unitPriceDelta ?? 0), `${product.name} selling price`)
    const costPriceCents = cents(adjustment?.unitCostOverride ?? product.costPrice, `${product.name} cost price`)
    if (product.trackStock && (!Number.isFinite(product.quantity) || product.quantity < 0)) {
      throw new SaleInputError(`${product.name} has an invalid stock balance.`)
    }
    if (product.trackStock) stockQuantities.set(product.id, (stockQuantities.get(product.id) ?? 0) + line.quantity)
    const lineCents = unitPriceCents * line.quantity
    const lineCostCents = costPriceCents * line.quantity
    if (!Number.isSafeInteger(lineCents) || !Number.isSafeInteger(lineCostCents)) throw new SaleInputError('Sale total is too large.')
    subtotalCents += lineCents
    cogsCents += lineCostCents
    unitsSold += line.quantity
    items.push({
      productId: product.id,
      productName: product.name,
      sku: product.sku || '',
      quantity: line.quantity,
      unitPrice: money(unitPriceCents),
      costPrice: money(costPriceCents),
      lineTotal: money(lineCents),
      modifiers: adjustment?.modifierSnapshots ?? [],
      preparationNotes: line.preparationNotes,
      recipeSnapshot: adjustment?.recipeSnapshot ?? null,
      menuItem: adjustment?.menuItem === true
    })
  }

  for (const [productId, quantity] of stockQuantities) {
    const product = productsById.get(productId)!
    if (product.quantity < quantity) throw new SaleInputError(`Insufficient stock for ${product.name}. Available: ${product.quantity}.`)
    stockUpdates.push({ product, quantityBefore: product.quantity, quantityAfter: product.quantity - quantity })
  }

  if (![subtotalCents, cogsCents, unitsSold].every(Number.isSafeInteger)) throw new SaleInputError('Sale total is too large.')
  const manualDiscountCents = cents(intent.discount, 'Discount')
  const promotionDiscountCents = cents(options.promotionDiscount ?? 0, 'Promotion discount')
  const manualLimit = options.manualDiscountLimitRate ?? MAX_DISCOUNT_RATE
  if (!Number.isFinite(manualLimit) || manualLimit < 0 || manualLimit > 1) throw new SaleInputError('Discount authority is invalid.')
  if (manualDiscountCents > Math.floor(subtotalCents * manualLimit)) {
    throw new SaleInputError(`Manual discount cannot exceed ${manualLimit * 100}% of the subtotal.`)
  }
  const discountCents = manualDiscountCents + promotionDiscountCents
  if (discountCents > subtotalCents) throw new SaleInputError('Combined discounts cannot exceed the subtotal.')
  const totalCents = subtotalCents - discountCents

  return {
    items,
    stockUpdates,
    itemCount: unitsSold,
    subtotal: money(subtotalCents),
    discount: money(discountCents),
    manualDiscount: money(manualDiscountCents),
    promotionDiscount: money(promotionDiscountCents),
    total: money(totalCents),
    totalCost: money(cogsCents),
    grossProfit: money(totalCents - cogsCents),
    paymentMethod: intent.paymentMethod,
    notes: intent.notes
  }
}

export function johannesburgDateKey(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}
