import type { Product } from '../models/product'
import type { Recipe } from '../models/recipe'
import { convertToBaseQuantity, requireValidUnit } from './units'

export function isMenuProduct(product: Pick<Product, 'menuItem' | 'productClass'> | null | undefined) {
  return Boolean(product?.menuItem || product?.productClass === 'menu_item')
}

export function isIngredientProduct(product: Pick<Product, 'isIngredient' | 'productClass'> | null | undefined) {
  return Boolean(product?.isIngredient || product?.productClass === 'ingredient')
}

export function recipeIngredientRequirements(
  recipe: Pick<Recipe, 'ingredients'>,
  saleQuantity: number,
  productsById: Map<string, Product>
) {
  if (!Number.isInteger(saleQuantity) || saleQuantity <= 0) {
    throw new Error('Recipe quantities must be positive whole numbers.')
  }

  return recipe.ingredients.map((ingredient) => {
    const product = productsById.get(ingredient.ingredientProductId)
    if (!product) {
      throw new Error(`Recipe references an ingredient that is missing from the business catalog: ${ingredient.ingredientProductId}`)
    }

    const normalizedUnit = requireValidUnit(ingredient.unit)
    const requiredBaseUnits = convertToBaseQuantity(ingredient.quantity * saleQuantity, normalizedUnit)
    if (requiredBaseUnits <= 0) {
      throw new Error(`Ingredient ${ingredient.ingredientProductId} needs a positive quantity.`)
    }

    return {
      ingredientProductId: ingredient.ingredientProductId,
      ingredientNameSnapshot: ingredient.ingredientNameSnapshot || product.name,
      quantity: ingredient.quantity * saleQuantity,
      unit: normalizedUnit,
      quantityBase: requiredBaseUnits,
      product,
      available: product.quantity
    }
  })
}

export function maxProducibleUnits(
  recipe: Pick<Recipe, 'ingredients'>,
  productsById: Map<string, Product>
) {
  if (!recipe.ingredients.length) return 0

  const limits: number[] = []

  for (const ingredient of recipe.ingredients) {
    const product = productsById.get(ingredient.ingredientProductId)
    if (!product) {
      throw new Error(`Recipe references an ingredient that is missing from the business catalog: ${ingredient.ingredientProductId}`)
    }
    const normalizedUnit = requireValidUnit(ingredient.unit)
    const requiredBaseUnits = convertToBaseQuantity(ingredient.quantity, normalizedUnit)
    if (requiredBaseUnits <= 0) {
      throw new Error(`Ingredient ${ingredient.ingredientProductId} needs a positive quantity.`)
    }

    if (!product.trackStock || product.quantity < requiredBaseUnits) {
      limits.push(0)
      continue
    }

    const productUnit = requireValidUnit(product.unit || 'each')
    const availableBaseUnits = convertToBaseQuantity(product.quantity, productUnit)
    limits.push(Math.floor(availableBaseUnits / requiredBaseUnits))
  }

  return limits.length ? Math.min(...limits) : 0
}

export function recipeAvailabilityStatus(
  recipe: Pick<Recipe, 'ingredients'>,
  productsById: Map<string, Product>
) {
  const limits = recipe.ingredients.map((ingredient) => {
    const product = productsById.get(ingredient.ingredientProductId)
    if (!product || !product.trackStock || product.status !== 'active') return { ingredientProductId: ingredient.ingredientProductId, ingredientName: ingredient.ingredientNameSnapshot, maxUnits: 0 }
    const required = convertToBaseQuantity(ingredient.quantity, requireValidUnit(ingredient.unit))
    const available = convertToBaseQuantity(product.quantity, requireValidUnit(product.unit || 'each'))
    return { ingredientProductId: product.id, ingredientName: ingredient.ingredientNameSnapshot || product.name, maxUnits: Math.floor(available / required) }
  }).sort((a, b) => a.maxUnits - b.maxUnits || a.ingredientName.localeCompare(b.ingredientName))
  const maxUnits = limits[0]?.maxUnits ?? 0
  return {
    available: maxUnits > 0,
    low: maxUnits > 0 && maxUnits <= 5,
    maxUnits,
    limitingIngredient: limits[0] ?? null
  }
}
