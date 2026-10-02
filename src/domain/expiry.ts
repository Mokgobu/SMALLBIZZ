export type ExpiryState = 'good' | 'approaching_expiry' | 'critical' | 'expires_today' | 'expired'

export function businessDateKey(date = new Date(), timeZone = 'Africa/Johannesburg') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function ordinal(dateKey: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error('Expiry date must use YYYY-MM-DD.')
  const [year, month, day] = dateKey.split('-').map(Number)
  const value = Date.UTC(year, month - 1, day)
  const check = new Date(value)
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) throw new Error('Expiry date is invalid.')
  return Math.floor(value / 86400000)
}

export function daysUntilExpiry(expiryDate: string, today = businessDateKey()) { return ordinal(expiryDate) - ordinal(today) }

export function expiryState(expiryDate: string, warningDays: number, criticalDays: number, today = businessDateKey()): ExpiryState {
  const days = daysUntilExpiry(expiryDate, today)
  if (days < 0) return 'expired'
  if (days === 0) return 'expires_today'
  if (days <= criticalDays) return 'critical'
  if (days <= warningDays) return 'approaching_expiry'
  return 'good'
}

export type ExpiryDiscountRule = { daysRemaining: number; percentage: number }
export function suggestedExpiryDiscount(expiryDate: string, rules: ExpiryDiscountRule[], today = businessDateKey()) {
  const days = daysUntilExpiry(expiryDate, today)
  if (days < 0) return null
  const applicable = [...rules].sort((a, b) => a.daysRemaining - b.daysRemaining).find((rule) => days <= rule.daysRemaining)
  return applicable?.percentage ?? null
}
