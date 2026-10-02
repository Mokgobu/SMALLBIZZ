import type { InventoryMovement } from '../models/inventory'

const legacyDirectSaleReason = 'Stock deducted by sale'
const recipeConsumptionReason = 'Ingredient consumed by menu sale'
const recipeConsumptionNote = 'Recipe ingredient consumption'

function hasRecipeEvidence(movement: InventoryMovement) {
  return movement.reason === recipeConsumptionReason
    || movement.notes === recipeConsumptionNote
    || Boolean(movement.menuItems?.length)
}

export function isRecipeIngredientConsumption(movement: InventoryMovement) {
  if (movement.type === 'sale') return hasRecipeEvidence(movement)
  if (movement.type !== 'recipe_consumption') return false

  // Builds before the movement-type correction wrote direct POS deductions as
  // recipe_consumption with this exact reason. Preserve older genuine recipe
  // records while excluding the historical direct-sale shape we can prove.
  return movement.reason !== legacyDirectSaleReason || hasRecipeEvidence(movement)
}

export function inventoryMovementLabel(movement: InventoryMovement) {
  if (movement.type === 'sale' || movement.type === 'recipe_consumption') {
    return isRecipeIngredientConsumption(movement) ? 'Recipe consumption' : 'POS sale'
  }

  const labels: Partial<Record<InventoryMovement['type'], string>> = {
    opening_stock: 'Opening stock',
    stock_in: 'Stock received',
    stock_out: 'Stock removed',
    adjustment: 'Adjustment',
    return: 'Customer return',
    damaged: 'Damaged stock',
    expired: 'Expired stock',
    receiving: 'Stock received',
    waste: 'Waste',
    expiry_write_off: 'Expiry write-off',
    damaged_write_off: 'Damaged write-off',
    stock_count: 'Stock count'
  }
  return labels[movement.type] ?? movement.type.replace(/_/g, ' ')
}
