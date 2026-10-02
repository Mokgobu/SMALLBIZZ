export function formatZar(value: number) {
  return new Intl.NumberFormat('en-ZA', {
    style: 'currency',
    currency: 'ZAR'
  }).format(value || 0)
}

export function formatDateTime(value: unknown) {
  if (!value) return 'Pending…'
  const maybeTimestamp = value as { toDate?: () => Date }
  const date = typeof maybeTimestamp.toDate === 'function'
    ? maybeTimestamp.toDate()
    : new Date(value as string | number | Date)
  return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleString('en-ZA')
}

export function dateInputValue(value: unknown) {
  if (!value) return ''
  const maybeTimestamp = value as { toDate?: () => Date }
  const date = typeof maybeTimestamp.toDate === 'function' ? maybeTimestamp.toDate() : new Date(value as string | number | Date)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}
