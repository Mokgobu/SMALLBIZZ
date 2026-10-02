export type ExpiryState = 'good' | 'approaching_expiry' | 'critical' | 'expires_today' | 'expired'

export function businessDateKey(date = new Date(), timeZone = 'Africa/Johannesburg') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}
function ordinal(key: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error('Expiry date must use YYYY-MM-DD.')
  const [y, m, d] = key.split('-').map(Number); const value = Date.UTC(y, m - 1, d); const check = new Date(value)
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) throw new Error('Expiry date is invalid.')
  return Math.floor(value / 86400000)
}
export function daysUntilExpiry(expiryDate: string, today: string) { return ordinal(expiryDate) - ordinal(today) }
export function expiryState(expiryDate: string, warningDays: number, criticalDays: number, today: string): ExpiryState {
  const days = daysUntilExpiry(expiryDate, today)
  if (days < 0) return 'expired'; if (days === 0) return 'expires_today'; if (days <= criticalDays) return 'critical'; if (days <= warningDays) return 'approaching_expiry'; return 'good'
}
export function suggestedExpiryDiscount(expiryDate: string, rules: Array<{ daysRemaining: number; percentage: number }>, today: string) {
  const days = daysUntilExpiry(expiryDate, today); if (days < 0) return null
  return [...rules].sort((a, b) => a.daysRemaining - b.daysRemaining).find((rule) => days <= rule.daysRemaining)?.percentage ?? null
}
