export const PAYMENT_METHODS = ['cash', 'card', 'eft', 'mobile', 'other'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export type SaleRequestLine = {
  productId: string
  quantity: number
  modifierOptionIds?: string[]
  preparationNotes?: string
}

export type SaleItem = {
  productId: string
  productName: string
  sku: string
  quantity: number
  unitPrice: number
  costPrice: number
  lineTotal: number
  modifiers?: Array<{ id: string; label: string; priceDelta: number }>
  preparationNotes?: string
  recipeSnapshot?: { recipeId: string; version: number; nameSnapshot: string; ingredients: unknown[] } | null
  menuItem?: boolean
}

export type Sale = {
  id: string
  items: SaleItem[]
  itemCount: number
  subtotal: number
  discount: number
  manualDiscount?: number
  promotionDiscount?: number
  promotionId?: string | null
  promotionNameSnapshot?: string | null
  promotionTypeSnapshot?: string | null
  total: number
  grossProfit: number
  totalCost?: number
  paymentMethod: PaymentMethod
  notes: string
  customerId: string | null
  customerNameSnapshot: string | null
  cashierNameSnapshot?: string | null
  cashierRoleSnapshot?: string | null
  createdAt?: unknown
  createdBy: string
}

export type CreateSaleResult = {
  saleId: string
  receipt: Sale
}

export type RecordSaleInput = {
  items: SaleRequestLine[]
  discount: number
  promotionId?: string | null
  paymentMethod: PaymentMethod
  notes: string
  customerId?: string | null
}
