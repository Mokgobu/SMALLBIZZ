// VAT calculation utilities. All amounts are in decimal numbers (e.g. 1000.50)
// Internally we convert to cents to avoid floating point rounding issues.

function toCents(amount: number){
  return Math.round(amount * 100)
}

function fromCents(cents: number){
  return cents / 100
}

export function calculateVATExclusive(subtotal: number, ratePercent: number){
  const cents = toCents(subtotal)
  const vatCents = Math.round(cents * ratePercent / 100)
  const totalCents = cents + vatCents
  return {
    subtotal: fromCents(cents),
    vat: fromCents(vatCents),
    total: fromCents(totalCents)
  }
}

export function calculateVATInclusive(totalWithVAT: number, ratePercent: number){
  const cents = toCents(totalWithVAT)
  const netCents = Math.round((cents * 100) / (100 + ratePercent))
  const vatCents = cents - netCents
  return {
    total: fromCents(cents),
    net: fromCents(netCents),
    vat: fromCents(vatCents)
  }
}

export function calculateSubtotal(items: {unitPrice:number, quantity:number, discount?:number}[]){
  let cents = 0
  for(const it of items){
    const line = Math.round(it.unitPrice * 100) * it.quantity
    const disc = it.discount ? Math.round(it.discount * 100) : 0
    cents += (line - disc)
  }
  return fromCents(cents)
}

export function calculateInvoiceTotal(items: {unitPrice:number, quantity:number, discount?:number}[], vatRate:number, mode: 'inclusive'|'exclusive'){
  const subtotal = calculateSubtotal(items)
  if(mode === 'exclusive'){
    return calculateVATExclusive(subtotal, vatRate)
  }
  // inclusive
  const cents = toCents(subtotal)
  const netObj = calculateVATInclusive(subtotal, vatRate)
  return { subtotal: netObj.net, vat: netObj.vat, total: netObj.total }
}
