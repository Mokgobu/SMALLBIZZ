export type Customer = {
  id: string
  firstName: string
  lastName: string
  displayName: string
  phone: string
  email: string
  birthday: string | null
  notes: string
  status: 'active' | 'archived'
  createdAt?: unknown
  updatedAt?: unknown
  createdBy: string
}

export type CustomerInput = Pick<Customer, 'firstName' | 'lastName' | 'phone' | 'email' | 'birthday' | 'notes'>

export type CustomerSalesSummary = {
  totalSpend: number
  transactionCount: number
  lastPurchaseAt: unknown | null
}
