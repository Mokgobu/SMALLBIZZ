export type UnitCategory = 'count' | 'weight' | 'volume'

export type UnitDefinition = {
  id: string
  label: string
  category: UnitCategory
  symbol: string
  toBase: number
  baseUnit: string
}

export const UNIT_DEFINITIONS: Record<string, UnitDefinition> = {
  each: { id: 'each', label: 'Each', category: 'count', symbol: 'each', toBase: 1, baseUnit: 'each' },
  unit: { id: 'unit', label: 'Unit', category: 'count', symbol: 'unit', toBase: 1, baseUnit: 'unit' },
  piece: { id: 'piece', label: 'Piece', category: 'count', symbol: 'piece', toBase: 1, baseUnit: 'piece' },
  slice: { id: 'slice', label: 'Slice', category: 'count', symbol: 'slice', toBase: 1, baseUnit: 'slice' },
  g: { id: 'g', label: 'Grams', category: 'weight', symbol: 'g', toBase: 1, baseUnit: 'g' },
  kg: { id: 'kg', label: 'Kilograms', category: 'weight', symbol: 'kg', toBase: 1000, baseUnit: 'g' },
  ml: { id: 'ml', label: 'Millilitres', category: 'volume', symbol: 'ml', toBase: 1, baseUnit: 'ml' },
  litre: { id: 'litre', label: 'Litre', category: 'volume', symbol: 'litre', toBase: 1000, baseUnit: 'ml' }
}

export const SUPPORTED_UNITS = Object.values(UNIT_DEFINITIONS)

export function normalizeUnit(unit: string): string {
  const value = unit.trim().toLowerCase()
  return UNIT_DEFINITIONS[value]?.id ?? value
}

export function unitCategory(unit: string): UnitCategory | null {
  const normalized = normalizeUnit(unit)
  return UNIT_DEFINITIONS[normalized]?.category ?? null
}

export function convertToBaseQuantity(quantity: number, unit: string): number {
  const normalized = normalizeUnit(unit)
  const definition = UNIT_DEFINITIONS[normalized]
  if (!definition) throw new Error(`Unsupported unit: ${unit}`)
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error(`Invalid quantity for unit ${unit}.`)
  return Number((quantity * definition.toBase).toFixed(6))
}

export function convertFromBaseQuantity(quantity: number, unit: string): number {
  const normalized = normalizeUnit(unit)
  const definition = UNIT_DEFINITIONS[normalized]
  if (!definition) throw new Error(`Unsupported unit: ${unit}`)
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error(`Invalid quantity for unit ${unit}.`)
  return Number((quantity / definition.toBase).toFixed(6))
}

export function canConvert(_quantity: number, fromUnit: string, toUnit: string): boolean {
  const from = UNIT_DEFINITIONS[normalizeUnit(fromUnit)]
  const to = UNIT_DEFINITIONS[normalizeUnit(toUnit)]
  if (!from || !to) return false
  return from.category === to.category && from.baseUnit === to.baseUnit
}

export function convertQuantity(quantity: number, fromUnit: string, toUnit: string): number {
  if (!canConvert(quantity, fromUnit, toUnit)) {
    throw new Error(`Unsafe conversion requested from ${fromUnit} to ${toUnit}.`)
  }
  const base = convertToBaseQuantity(quantity, fromUnit)
  return convertFromBaseQuantity(base, toUnit)
}

export function requireValidUnit(unit: string): string {
  const normalized = normalizeUnit(unit)
  if (!UNIT_DEFINITIONS[normalized]) {
    throw new Error(`Unsupported unit: ${unit}`)
  }
  return normalized
}

export function requirePositiveQuantity(value: number, field: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be a positive number.`)
  }
  return value
}
