import { canConvertUnits, convertQuantity, normalizeUnit, positiveQuantity, type SupportedUnit } from './unitsDomain.js'

export type RecipeIngredient = { ingredientProductId: string; ingredientNameSnapshot: string; quantity: number; unit: SupportedUnit }
export type IngredientAdjustment = RecipeIngredient & { mode: 'add' | 'remove' }
export type ModifierOption = { id: string; label: string; priceDelta: number; ingredientAdjustments: IngredientAdjustment[] }
export type ModifierGroup = { id: string; name: string; kind: 'single' | 'multi'; optional: boolean; maxSelections: number; options: ModifierOption[] }
export type RecipeDocument = { id: string; productId: string; nameSnapshot: string; version: number; active: boolean; ingredients: RecipeIngredient[]; modifierGroups: ModifierGroup[] }
export type RestaurantProduct = { id: string; name: string; quantity: number; trackStock: boolean; status: string; unit?: string; costPrice?: number; sellingPrice?: number; menuItem?: boolean; productClass?: string; recipeId?: string | null; tracksExpiry?: boolean; isIngredient?: boolean }

const cleanId = (value: unknown, label: string) => { const id = typeof value === 'string' ? value.trim() : ''; if (!/^[A-Za-z0-9_-]{1,150}$/.test(id)) throw new Error(`Choose a valid ${label}.`); return id }
const cleanText = (value: unknown, label: string, max = 100) => { const text = typeof value === 'string' ? value.trim() : ''; if (!text || text.length > max) throw new Error(`${label} is required and must be ${max} characters or fewer.`); return text }
const money = (value: unknown, label: string) => { const amount = Number(value ?? 0); if (!Number.isFinite(amount) || amount < -100000 || amount > 100000) throw new Error(`${label} is invalid.`); return Math.round(amount * 100) / 100 }

function parseIngredient(value: unknown, label = 'Recipe ingredient'): RecipeIngredient {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is invalid.`)
  const row = value as Record<string, unknown>
  return { ingredientProductId: cleanId(row.ingredientProductId, 'ingredient'), ingredientNameSnapshot: cleanText(row.ingredientNameSnapshot, 'Ingredient name'), quantity: positiveQuantity(row.quantity, 'Ingredient quantity'), unit: normalizeUnit(row.unit) }
}

export function parseRecipe(data: unknown, expectedProductId: string): RecipeDocument {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('The selected menu item recipe is unavailable.')
  const recipe = data as Record<string, unknown>
  const productId = cleanId(recipe.productId, 'menu product')
  if (productId !== expectedProductId) throw new Error('The recipe does not match the selected menu product.')
  const rawIngredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : []
  if (!rawIngredients.length || rawIngredients.length > 100) throw new Error('Menu items must reference between 1 and 100 ingredients.')
  const ingredients = rawIngredients.map((row) => parseIngredient(row))
  const ingredientIds = new Set<string>()
  for (const ingredient of ingredients) {
    if (ingredient.ingredientProductId === productId) throw new Error('A menu item cannot use itself as an ingredient.')
    if (ingredientIds.has(ingredient.ingredientProductId)) throw new Error('Duplicate ingredients must be merged into one recipe row.')
    ingredientIds.add(ingredient.ingredientProductId)
  }
  const groupIds = new Set<string>(), optionIds = new Set<string>()
  const rawGroups = Array.isArray(recipe.modifierGroups) ? recipe.modifierGroups : []
  if (rawGroups.length > 20) throw new Error('A recipe can contain at most 20 modifier groups.')
  const modifierGroups = rawGroups.map((value): ModifierGroup => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Modifier group is invalid.')
    const group = value as Record<string, unknown>, id = cleanId(group.id, 'modifier group')
    if (groupIds.has(id)) throw new Error('Modifier group IDs must be unique.'); groupIds.add(id)
    const kind = group.kind === 'single' || group.kind === 'multi' ? group.kind : null
    if (!kind) throw new Error('Modifier groups must be single or multi select.')
    const rawOptions = Array.isArray(group.options) ? group.options : []
    if (!rawOptions.length || rawOptions.length > 20) throw new Error('Each modifier group needs between 1 and 20 options.')
    const options = rawOptions.map((rawOption) => {
      if (!rawOption || typeof rawOption !== 'object' || Array.isArray(rawOption)) throw new Error('Modifier option is invalid.')
      const option = rawOption as Record<string, unknown>, optionId = cleanId(option.id, 'modifier option')
      if (optionIds.has(optionId)) throw new Error('Modifier option IDs must be unique across the recipe.'); optionIds.add(optionId)
      const rawAdjustments = Array.isArray(option.ingredientAdjustments) ? option.ingredientAdjustments : []
      if (rawAdjustments.length > 20) throw new Error('A modifier option can contain at most 20 ingredient adjustments.')
      const ingredientAdjustments = rawAdjustments.map((rawAdjustment) => {
        const adjustment = parseIngredient(rawAdjustment, 'Modifier ingredient adjustment'), mode = (rawAdjustment as Record<string, unknown>).mode
        if (mode !== 'add' && mode !== 'remove') throw new Error('Modifier ingredient adjustment mode is invalid.')
        if (adjustment.ingredientProductId === productId) throw new Error('A menu item cannot use itself as a modifier ingredient.')
        return { ...adjustment, mode: mode as 'add' | 'remove' }
      })
      return { id: optionId, label: cleanText(option.label, 'Modifier option label'), priceDelta: money(option.priceDelta, 'Modifier price'), ingredientAdjustments }
    })
    const maxSelections = group.maxSelections == null ? (kind === 'single' ? 1 : options.length) : Number(group.maxSelections)
    if (!Number.isInteger(maxSelections) || maxSelections < 1 || maxSelections > options.length || (kind === 'single' && maxSelections !== 1)) throw new Error('Modifier maximum selections are invalid.')
    return { id, name: cleanText(group.name, 'Modifier group name'), kind, optional: group.optional !== false, maxSelections, options }
  })
  const version = Number(recipe.version ?? 1)
  if (!Number.isInteger(version) || version < 1) throw new Error('Recipe version is invalid.')
  return { id: typeof recipe.id === 'string' ? recipe.id : productId, productId, nameSnapshot: cleanText(recipe.nameSnapshot ?? 'Recipe', 'Recipe name'), version, active: recipe.active === true, ingredients, modifierGroups }
}

function stockQuantityFor(ingredient: RecipeIngredient, product: RestaurantProduct, multiplier = 1) {
  const productUnit = normalizeUnit(product.unit ?? 'each')
  if (!canConvertUnits(ingredient.unit, productUnit)) throw new Error(`${ingredient.ingredientNameSnapshot} uses ${ingredient.unit}, which is incompatible with its stock unit ${productUnit}.`)
  return convertQuantity(ingredient.quantity * multiplier, ingredient.unit, productUnit)
}

export function collectIngredientRequirements(recipe: RecipeDocument, saleQuantity: number, productsById: Map<string, RestaurantProduct>) {
  if (!Number.isInteger(saleQuantity) || saleQuantity <= 0) throw new Error('Menu item quantities must be positive whole numbers.')
  return recipe.ingredients.map((ingredient) => { const product = productsById.get(ingredient.ingredientProductId); if (!product) throw new Error(`Recipe references an ingredient that is missing from the business catalog: ${ingredient.ingredientProductId}`); return { ...ingredient, quantity: ingredient.quantity * saleQuantity, stockQuantity: stockQuantityFor(ingredient, product, saleQuantity), product } })
}

export function resolveRecipeLine(recipe: RecipeDocument, saleQuantity: number, selectedOptionIds: string[], productsById: Map<string, RestaurantProduct>) {
  const unique = new Set(selectedOptionIds)
  if (unique.size !== selectedOptionIds.length) throw new Error('A modifier option cannot be selected more than once.')
  const knownOptions = new Map(recipe.modifierGroups.flatMap((group) => group.options.map((option) => [option.id, { group, option }] as const)))
  for (const id of unique) if (!knownOptions.has(id)) throw new Error('The selected modifier is not available for this menu item.')
  for (const group of recipe.modifierGroups) { const selected = group.options.filter((option) => unique.has(option.id)); if (!group.optional && selected.length === 0) throw new Error(`${group.name} requires a selection.`); if (selected.length > group.maxSelections) throw new Error(`${group.name} allows at most ${group.maxSelections} selection(s).`) }
  const requirementMap = new Map<string, { ingredient: RecipeIngredient; stockQuantity: number; product: RestaurantProduct; modes: Set<string> }>()
  for (const requirement of collectIngredientRequirements(recipe, saleQuantity, productsById)) requirementMap.set(requirement.ingredientProductId, { ingredient: requirement, stockQuantity: requirement.stockQuantity, product: requirement.product, modes: new Set(['base']) })
  const selected = selectedOptionIds.map((id) => knownOptions.get(id)!.option)
  for (const option of selected) for (const adjustment of option.ingredientAdjustments) {
    const product = productsById.get(adjustment.ingredientProductId)
    if (!product) throw new Error(`Modifier references an ingredient that is missing from the business catalog: ${adjustment.ingredientProductId}`)
    const stockDelta = stockQuantityFor(adjustment, product, saleQuantity)
    const current = requirementMap.get(adjustment.ingredientProductId) ?? { ingredient: adjustment, stockQuantity: 0, product, modes: new Set<string>() }
    if ((current.modes.has('add') && adjustment.mode === 'remove') || (current.modes.has('remove') && adjustment.mode === 'add')) throw new Error(`Conflicting modifiers change ${adjustment.ingredientNameSnapshot} in opposite directions.`)
    current.modes.add(adjustment.mode); current.stockQuantity = Number((current.stockQuantity + (adjustment.mode === 'add' ? stockDelta : -stockDelta)).toFixed(6))
    if (current.stockQuantity < 0) throw new Error(`Modifier removal exceeds the recipe quantity for ${adjustment.ingredientNameSnapshot}.`)
    requirementMap.set(adjustment.ingredientProductId, current)
  }
  return { requirements: [...requirementMap.values()].filter((item) => item.stockQuantity > 0.000001).map(({ ingredient, stockQuantity, product }) => ({ ...ingredient, stockQuantity, product })), unitPriceDelta: Math.round(selected.reduce((sum, option) => sum + option.priceDelta, 0) * 100) / 100, modifierSnapshots: selected.map((option) => ({ id: option.id, label: option.label, priceDelta: option.priceDelta, ingredientAdjustments: option.ingredientAdjustments })), recipeSnapshot: { recipeId: recipe.id, version: recipe.version, nameSnapshot: recipe.nameSnapshot, ingredients: recipe.ingredients } }
}

export function aggregateIngredientStockUpdates(lines: Array<{ requirements: ReturnType<typeof resolveRecipeLine>['requirements'] }>) {
  const totals = new Map<string, { product: RestaurantProduct; quantityConsumed: number }>()
  for (const line of lines) for (const requirement of line.requirements) { const current = totals.get(requirement.product.id) ?? { product: requirement.product, quantityConsumed: 0 }; current.quantityConsumed = Number((current.quantityConsumed + requirement.stockQuantity).toFixed(6)); totals.set(requirement.product.id, current) }
  return [...totals.values()].map((item) => { if (!item.product.trackStock || item.product.status !== 'active') throw new Error(`${item.product.name} must be an active stock-tracked ingredient.`); if (item.product.quantity + 0.000001 < item.quantityConsumed) throw new Error(`Insufficient stock for ${item.product.name}. Available: ${item.product.quantity}.`); return { product: item.product, quantityBefore: item.product.quantity, quantityAfter: Number((item.product.quantity - item.quantityConsumed).toFixed(6)), quantityConsumed: item.quantityConsumed } })
}

export function recipeAvailability(recipe: RecipeDocument, productsById: Map<string, RestaurantProduct>, lowThreshold = 5) {
  const limits = recipe.ingredients.map((ingredient) => { const product = productsById.get(ingredient.ingredientProductId); if (!product || product.status !== 'active' || !product.trackStock) return { ingredientProductId: ingredient.ingredientProductId, ingredientName: ingredient.ingredientNameSnapshot, maxUnits: 0 }; const perUnit = stockQuantityFor(ingredient, product); return { ingredientProductId: product.id, ingredientName: ingredient.ingredientNameSnapshot || product.name, maxUnits: Math.floor((product.quantity + 0.000001) / perUnit) } })
  const limitingIngredient = limits.sort((a, b) => a.maxUnits - b.maxUnits || a.ingredientName.localeCompare(b.ingredientName))[0] ?? null, maxUnits = limitingIngredient?.maxUnits ?? 0
  return { available: recipe.active && maxUnits > 0, low: recipe.active && maxUnits > 0 && maxUnits <= lowThreshold, maxUnits, limitingIngredient }
}

export function assertRecipeProductReferences(recipe: RecipeDocument, menuProduct: RestaurantProduct, productsById: Map<string, RestaurantProduct>) {
  if (!(menuProduct.menuItem || menuProduct.productClass === 'menu_item')) throw new Error('Recipes can only be assigned to menu items.')
  const rows = [...recipe.ingredients, ...recipe.modifierGroups.flatMap((group) => group.options.flatMap((option) => option.ingredientAdjustments))]
  for (const row of rows) { const product = productsById.get(row.ingredientProductId); if (!product) throw new Error(`Ingredient ${row.ingredientProductId} does not belong to this business.`); if (!(product.productClass === 'ingredient' || product.isIngredient)) throw new Error(`${product.name} is not classified as an ingredient.`); stockQuantityFor(row, product) }
}

export function canTransitionKitchenStatus(previous: string, next: string) { return ({ new: 'preparing', preparing: 'ready', ready: 'completed' } as Record<string, string>)[previous] === next }

export function nextRecipeVersion(current: number | null | undefined) { return Number.isInteger(current) && Number(current) > 0 ? Number(current) + 1 : 1 }

export function kitchenItemsForSale(items: Array<{ productId: string; productName: string; quantity: number; menuItem: boolean; modifiers: Array<{ id: string; label: string; priceDelta: number }>; preparationNotes: string; recipeSnapshot?: { recipeId: string; version: number } | null }>) {
  return items.filter((item) => item.menuItem).map((item) => ({ productId: item.productId, productName: item.productName, quantity: item.quantity, modifiers: item.modifiers, preparationNotes: item.preparationNotes, recipeId: item.recipeSnapshot?.recipeId ?? null, recipeVersion: item.recipeSnapshot?.version ?? null }))
}
