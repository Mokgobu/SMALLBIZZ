export type ProductStatus = 'active' | 'archived'

export type ProductClass = 'inventory_item' | 'menu_item' | 'service' | 'ingredient'

export type Product = {
  id: string
  name: string
  description: string
  sku: string
  barcode: string
  category: string
  sellingPrice: number
  costPrice: number
  quantity: number
  reorderLevel: number
  trackStock: boolean
  tracksExpiry?: boolean
  shelfLifeDays?: number | null
  expiryWarningDays?: number
  expiryCriticalDays?: number
  unit: string
  status: ProductStatus
  productClass?: ProductClass
  menuItem?: boolean
  recipeId?: string | null
  isIngredient?: boolean
  lastMovementId: string | null
  createdAt?: unknown
  updatedAt?: unknown
  createdBy: string
}

export type ProductInput = Omit<
  Product,
  'id' | 'status' | 'lastMovementId' | 'createdAt' | 'updatedAt' | 'createdBy'
>

export type ProductStockStatus = 'in_stock' | 'low_stock' | 'out_of_stock' | 'not_tracked'
