export type RecipeIngredient = {
  ingredientProductId: string
  ingredientNameSnapshot: string
  quantity: number
  unit: string
}

export type ModifierOption = {
  id: string
  label: string
  priceDelta: number
  ingredientAdjustments?: Array<{
    ingredientProductId: string
    quantity: number
    unit: string
    mode: 'add' | 'remove'
  }>
}

export type ModifierGroup = {
  id: string
  name: string
  kind: 'single' | 'multi'
  optional: boolean
  maxSelections: number
  options: ModifierOption[]
}

export type Recipe = {
  id: string
  productId: string
  nameSnapshot: string
  version: number
  active: boolean
  ingredients: RecipeIngredient[]
  modifierGroups?: ModifierGroup[]
  createdBy: string
  createdAt?: unknown
  updatedAt?: unknown
}

export type RecipeInput = Omit<Recipe, 'id' | 'createdBy' | 'createdAt' | 'updatedAt'> & {
  recipeId?: string
}

export type MenuAvailability = {
  productId: string
  recipeId: string
  recipeVersion: number
  available: boolean
  low: boolean
  maxUnits: number
  limitingIngredient: { ingredientProductId: string; ingredientName: string; maxUnits: number } | null
}

export type KitchenStatus = 'new' | 'preparing' | 'ready' | 'completed'
export type KitchenOrder = {
  id: string
  orderNumber: string
  saleId: string
  status: KitchenStatus
  items: Array<{ productId: string; productName: string; quantity: number; modifiers: Array<{ id: string; label: string; priceDelta: number }>; preparationNotes: string }>
  cashierNameSnapshot: string | null
  createdAt: number | null
  updatedAt: number | null
}
