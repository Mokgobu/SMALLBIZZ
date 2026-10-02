export const INVENTORY_MOVEMENT_TYPES = [
  'opening_stock',
  'stock_in',
  'stock_out',
  'sale',
  'adjustment',
  'return',
  'damaged',
  'expired',
  'recipe_consumption',
  'receiving',
  'waste',
  'expiry_write_off',
  'damaged_write_off',
  'stock_count'
] as const

export type InventoryMovementType = (typeof INVENTORY_MOVEMENT_TYPES)[number]
export type ManualInventoryMovementType = Exclude<InventoryMovementType, 'opening_stock' | 'sale'>

export type InventoryMovement = {
  id: string
  productId: string
  productName: string
  type: InventoryMovementType
  quantityChange: number
  quantityBefore: number
  quantityAfter: number
  reason: string
  notes?: string
  referenceId: string | null
  createdAt?: unknown
  createdBy: string
  staffNameSnapshot?: string | null
  batchId?: string | null
  batchAllocations?: Array<{ batchId: string; quantity: number; expiryDate?: string | null }>
  unit?: string
  menuItems?: Array<{ productId: string; productName: string; recipeVersion: number }>
}

export type StockAdjustmentInput = {
  productId: string
  type: ManualInventoryMovementType
  quantity: number
  reason: string
}
