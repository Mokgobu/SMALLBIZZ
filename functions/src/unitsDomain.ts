export const SUPPORTED_UNITS = ['each', 'unit', 'piece', 'slice', 'g', 'kg', 'ml', 'litre'] as const
export type SupportedUnit = typeof SUPPORTED_UNITS[number]

type UnitDefinition = { family: 'count' | 'weight' | 'volume'; baseUnit: string; toBase: number }

const definitions: Record<SupportedUnit, UnitDefinition> = {
  each: { family: 'count', baseUnit: 'each', toBase: 1 },
  unit: { family: 'count', baseUnit: 'unit', toBase: 1 },
  piece: { family: 'count', baseUnit: 'piece', toBase: 1 },
  slice: { family: 'count', baseUnit: 'slice', toBase: 1 },
  g: { family: 'weight', baseUnit: 'g', toBase: 1 },
  kg: { family: 'weight', baseUnit: 'g', toBase: 1000 },
  ml: { family: 'volume', baseUnit: 'ml', toBase: 1 },
  litre: { family: 'volume', baseUnit: 'ml', toBase: 1000 }
}

export function normalizeUnit(value: unknown): SupportedUnit {
  const unit = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (!SUPPORTED_UNITS.includes(unit as SupportedUnit)) throw new Error(`Unsupported unit: ${String(value)}`)
  return unit as SupportedUnit
}

export function canConvertUnits(fromValue: unknown, toValue: unknown) {
  try {
    const from = definitions[normalizeUnit(fromValue)]
    const to = definitions[normalizeUnit(toValue)]
    return from.family === to.family && from.baseUnit === to.baseUnit
  } catch {
    return false
  }
}

export function convertQuantity(quantity: number, fromValue: unknown, toValue: unknown) {
  const fromUnit = normalizeUnit(fromValue)
  const toUnit = normalizeUnit(toValue)
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error('Quantity must be a valid non-negative number.')
  if (!canConvertUnits(fromUnit, toUnit)) throw new Error(`Unsafe conversion requested from ${fromUnit} to ${toUnit}.`)
  return Number((quantity * definitions[fromUnit].toBase / definitions[toUnit].toBase).toFixed(6))
}

export function positiveQuantity(value: unknown, label = 'Quantity') {
  const quantity = Number(value)
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) throw new Error(`${label} must be a valid positive number.`)
  return Number(quantity.toFixed(6))
}
