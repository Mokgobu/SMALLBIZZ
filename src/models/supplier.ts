export type Supplier = {
  id: string
  name: string
  contactPerson: string
  phone: string
  email: string
  address: string
  notes: string
  status: 'active' | 'archived'
  createdAt?: unknown
  updatedAt?: unknown
  createdBy: string
}

export type SupplierInput = Pick<Supplier, 'name' | 'contactPerson' | 'phone' | 'email' | 'address' | 'notes'>
