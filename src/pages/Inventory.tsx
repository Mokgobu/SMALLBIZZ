import { useCallback, useEffect, useMemo, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import EmptyState from '../components/feedback/EmptyState'
import ErrorMessage from '../components/feedback/ErrorMessage'
import LoadingScreen from '../components/feedback/LoadingScreen'
import PageHeader from '../components/layout/PageHeader'
import { requireFirebase } from '../config/firebase'
import { getProductStockStatus } from '../domain/commerce'
import { inventoryMovementLabel } from '../domain/inventoryMovements'
import { useAuth } from '../hooks/useAuth'
import { usePagedData } from '../hooks/usePagedData'
import type { ManualInventoryMovementType } from '../models/inventory'
import type { Product } from '../models/product'
import type { Supplier } from '../models/supplier'
import { createFirestoreInventoryRepository } from '../services/inventory'
import { createFirestoreProductRepository } from '../services/products'
import { createFirestoreSupplierRepository } from '../services/suppliers'
import { createOperationalInventoryService, createOperationalProductRepository } from '../services/operations'
import { getFirebaseErrorMessage } from '../utils/firebaseErrors'
import { formatDateTime } from '../utils/format'

const adjustmentTypes: Array<{ value: ManualInventoryMovementType; label: string }> = [
  { value: 'stock_in', label: 'Stock received' },
  { value: 'stock_out', label: 'Stock removed' },
  { value: 'adjustment', label: 'Correction (+ or -)' },
  { value: 'return', label: 'Customer return' },
  { value: 'damaged', label: 'Damaged stock' },
  { value: 'expired', label: 'Expired stock' }
]

const writeOffReasons = [
  { value: 'expired', label: 'Expired' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'spoiled', label: 'Spoiled' },
  { value: 'stolen', label: 'Stolen' },
  { value: 'internal_use', label: 'Internal use' },
  { value: 'stock_count_correction', label: 'Stock count correction' },
  { value: 'other', label: 'Other' }
] as const

type ExpiryBatchEntry = {
  id: string
  batchId: string
  productId: string
  productNameSnapshot: string
  categorySnapshot: string
  quantityReceived: number
  quantityRemaining: number
  expiryDate: string | null
  supplierNameSnapshot: string | null
  reference: string
  status: string
  expiryState: string
  daysRemaining: number
  suggestedDiscount: number | null
}

type ReceiveFormState = {
  productId: string
  quantity: number
  supplierId: string
  reference: string
  costPrice: string
  expiryDate: string
}

type WriteOffFormState = {
  productId: string
  batchId: string
  quantity: number
  reason: (typeof writeOffReasons)[number]['value']
  notes: string
}

type StockCountFormState = {
  productId: string
  countedQuantity: number
  reason: string
  notes: string
}

export default function Inventory() {
  const { business, user, membership, hasPermission } = useAuth()
  const canAdjust = hasPermission('adjust_inventory')
  const canReceive = hasPermission('receive_stock')
  const canWriteOff = hasPermission('write_off_stock')
  const canCount = hasPermission('perform_stock_count')
  const canManageProducts = hasPermission('manage_products')
  const canEnterCostPrice = membership?.role === 'owner' || membership?.role === 'manager'

  const repositories = useMemo(() => business && user ? {
    inventory: canManageProducts
      ? createFirestoreInventoryRepository(business.id, user.uid)
      : { ...createFirestoreInventoryRepository(business.id, user.uid), ...createOperationalInventoryService() },
    products: canManageProducts ? createFirestoreProductRepository(business.id, user.uid) : createOperationalProductRepository(),
    suppliers: createFirestoreSupplierRepository(business.id, user.uid)
  } : null, [business, user, canManageProducts])

  const movementPage = usePagedData(repositories ? repositories.inventory.listMovementPage : null, 'Unable to load movement history.')
  const { functions } = requireFirebase()
  const receiveStock = useMemo(() => httpsCallable<{ productId: string; quantity: number; supplierId: string | null; reference: string; costPrice?: number; expiryDate: string | null }, { batchId: string; quantityAfter: number }>(functions, 'receiveStock'), [functions])
  const writeOffStock = useMemo(() => httpsCallable<{ productId: string; batchId: string | null; quantity: number; reason: string; notes: string }, { quantityAfter: number }>(functions, 'writeOffStock'), [functions])
  const performStockCount = useMemo(() => httpsCallable<{ productId: string; countedQuantity: number; reason: string; notes: string }, { quantityAfter: number; variance: number }>(functions, 'performStockCount'), [functions])
  const listExpiryBatches = useMemo(
    () => httpsCallable<{ cursorExpiryDate?: string | null; cursorId?: string | null; pageSize?: number }, { items: ExpiryBatchEntry[]; cursor: { expiryDate: string; id: string } | null; hasMore: boolean }>(functions, 'listExpiryBatches'),
    [functions]
  )

  const [products, setProducts] = useState<Product[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [batches, setBatches] = useState<ExpiryBatchEntry[]>([])
  const [loadingProducts, setLoadingProducts] = useState(true)
  const [loadingSuppliers, setLoadingSuppliers] = useState(true)
  const [loadingBatches, setLoadingBatches] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showAdjustment, setShowAdjustment] = useState(false)
  const [operation, setOperation] = useState<'receive' | 'writeoff' | 'count' | null>(null)
  const [productId, setProductId] = useState('')
  const [type, setType] = useState<ManualInventoryMovementType>('stock_in')
  const [quantity, setQuantity] = useState(1)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const [receiveForm, setReceiveForm] = useState<ReceiveFormState>({
    productId: '', quantity: 1, supplierId: '', reference: '', costPrice: '', expiryDate: ''
  })
  const [writeOffForm, setWriteOffForm] = useState<WriteOffFormState>({
    productId: '', batchId: '', quantity: 1, reason: 'expired', notes: ''
  })
  const [stockCountForm, setStockCountForm] = useState<StockCountFormState>({
    productId: '', countedQuantity: 0, reason: '', notes: ''
  })

  useEffect(() => {
    if (!repositories) return
    const unsubscribeProducts = repositories.products.subscribe(
      (data) => { setProducts(data); setLoadingProducts(false) },
      (loadError) => { setError(getFirebaseErrorMessage(loadError, 'Unable to load current stock.')); setLoadingProducts(false) }
    )
    const unsubscribeSuppliers = repositories.suppliers.subscribe(
      (data) => { setSuppliers(data.filter((supplier) => supplier.status === 'active')); setLoadingSuppliers(false) },
      (loadError) => { setError(getFirebaseErrorMessage(loadError, 'Unable to load suppliers.')); setLoadingSuppliers(false) }
    )
    return () => { unsubscribeProducts(); unsubscribeSuppliers() }
  }, [repositories])

  const loadAllBatches = useCallback(async () => {
    setLoadingBatches(true)
    try {
      let cursor: { expiryDate: string; id: string } | null = null
      const collected: ExpiryBatchEntry[] = []
      do {
        const pageResult: {
          data: {
            items: ExpiryBatchEntry[]
            cursor: { expiryDate: string; id: string } | null
            hasMore: boolean
          }
        } = await listExpiryBatches({
          cursorExpiryDate: cursor?.expiryDate ?? null,
          cursorId: cursor?.id ?? null,
          pageSize: 100
        })
        collected.push(...pageResult.data.items)
        cursor = pageResult.data.cursor
      } while (cursor)
      setBatches(collected)
    } catch (loadError) {
      setError(getFirebaseErrorMessage(loadError, 'Unable to load batch history.'))
    } finally {
      setLoadingBatches(false)
    }
  }, [listExpiryBatches])

  useEffect(() => {
    void loadAllBatches()
  }, [loadAllBatches])

  const trackedProducts = products.filter((product) => product.trackStock && product.status === 'active')
  const lowStock = trackedProducts.filter((product) => getProductStockStatus(product) === 'low_stock')
  const outOfStock = trackedProducts.filter((product) => getProductStockStatus(product) === 'out_of_stock')

  const selectedReceiveProduct = trackedProducts.find((product) => product.id === receiveForm.productId) ?? null
  const selectedWriteOffProduct = trackedProducts.find((product) => product.id === writeOffForm.productId) ?? null
  const selectedWriteOffBatch = batches.find((batch) => batch.id === writeOffForm.batchId) ?? null
  const selectedCountProduct = trackedProducts.find((product) => product.id === stockCountForm.productId) ?? null

  const writeOffMax = selectedWriteOffProduct?.tracksExpiry
    ? (selectedWriteOffBatch?.quantityRemaining ?? 0)
    : (selectedWriteOffProduct?.quantity ?? 0)

  const saveAdjustment = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!repositories) return
    setSaving(true); setError(null); setSuccess(null)
    try {
      await repositories.inventory.adjustStock({ productId, type, quantity, reason })
      await movementPage.reload()
      setSuccess('Stock updated and the inventory movement was recorded.')
      setShowAdjustment(false); setProductId(''); setQuantity(1); setReason(''); setType('stock_in')
    } catch (saveError) { setError(getFirebaseErrorMessage(saveError, saveError instanceof Error ? saveError.message : 'Unable to adjust stock.')) }
    finally { setSaving(false) }
  }

  const handleReceiveSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!receiveForm.productId) {
      setError('Choose a product to receive stock.')
      return
    }
    setSaving(true); setError(null); setSuccess(null)
    try {
      const response = await receiveStock({
        productId: receiveForm.productId,
        quantity: receiveForm.quantity,
        supplierId: receiveForm.supplierId || null,
        reference: receiveForm.reference,
        costPrice: canEnterCostPrice && receiveForm.costPrice ? Number(receiveForm.costPrice) : undefined,
        expiryDate: selectedReceiveProduct?.tracksExpiry ? (receiveForm.expiryDate || null) : null
      })
      setSuccess(`Stock received successfully. Quantity after receipt: ${response.data.quantityAfter}.`)
      setReceiveForm({ productId: '', quantity: 1, supplierId: '', reference: '', costPrice: '', expiryDate: '' })
      setOperation(null)
      await movementPage.reload()
      await loadAllBatches()
    } catch (saveError) {
      setError(getFirebaseErrorMessage(saveError, saveError instanceof Error ? saveError.message : 'Unable to receive stock.'))
    } finally {
      setSaving(false)
    }
  }

  const handleWriteOffSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!writeOffForm.productId) {
      setError('Choose a product to write off.')
      return
    }
    setSaving(true); setError(null); setSuccess(null)
    try {
      const response = await writeOffStock({
        productId: writeOffForm.productId,
        batchId: selectedWriteOffProduct?.tracksExpiry ? (writeOffForm.batchId || null) : null,
        quantity: writeOffForm.quantity,
        reason: writeOffForm.reason,
        notes: writeOffForm.notes
      })
      setSuccess(`Write-off completed. Stock after adjustment: ${response.data.quantityAfter}.`)
      setWriteOffForm({ productId: '', batchId: '', quantity: 1, reason: 'expired', notes: '' })
      setOperation(null)
      await movementPage.reload()
      await loadAllBatches()
    } catch (saveError) {
      setError(getFirebaseErrorMessage(saveError, saveError instanceof Error ? saveError.message : 'Unable to write off stock.'))
    } finally {
      setSaving(false)
    }
  }

  const handleStockCountSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!stockCountForm.productId) {
      setError('Choose a product to count.')
      return
    }
    setSaving(true); setError(null); setSuccess(null)
    try {
      const response = await performStockCount({
        productId: stockCountForm.productId,
        countedQuantity: stockCountForm.countedQuantity,
        reason: stockCountForm.reason,
        notes: stockCountForm.notes
      })
      setSuccess(`Stock count saved. Variance: ${response.data.variance > 0 ? '+' : ''}${response.data.variance}.`)
      setStockCountForm({ productId: '', countedQuantity: 0, reason: '', notes: '' })
      setOperation(null)
      await movementPage.reload()
      await loadAllBatches()
    } catch (saveError) {
      setError(getFirebaseErrorMessage(saveError, saveError instanceof Error ? saveError.message : 'Unable to save stock count.'))
    } finally {
      setSaving(false)
    }
  }

  const resetOperations = () => {
    setOperation(null)
    setError(null)
    setSuccess(null)
  }

  if (loadingProducts || loadingSuppliers || movementPage.loading || loadingBatches) return <LoadingScreen message="Loading inventory…" />

  return (
    <main className="p-4 md:p-6">
      <div className="mx-auto max-w-7xl">
        <PageHeader
          title="Inventory"
          description="Review stock levels, capture receiving and write-off events, and keep count adjustments auditable."
          action={canAdjust ? <button onClick={() => setShowAdjustment((open) => !open)} className="rounded bg-primary px-4 py-2 text-white">Adjust stock</button> : undefined}
        />

        {(error || movementPage.error) && <ErrorMessage message={error || movementPage.error || ''} />}
        {success && <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700" role="status">{success}</div>}

        {canAdjust && showAdjustment && <form onSubmit={saveAdjustment} className="card mb-6">
          <h2 className="mb-4 text-lg font-semibold">Quick stock adjustment</h2>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <label>
              <span className="text-sm">Product *</span>
              <select value={productId} onChange={(event) => setProductId(event.target.value)} className="mt-1 w-full rounded border px-3 py-2" required>
                <option value="">Select product</option>
                {trackedProducts.map((product) => <option key={product.id} value={product.id}>{product.name} ({product.quantity})</option>)}
              </select>
            </label>
            <label>
              <span className="text-sm">Movement type *</span>
              <select value={type} onChange={(event) => setType(event.target.value as ManualInventoryMovementType)} className="mt-1 w-full rounded border px-3 py-2">
                {adjustmentTypes.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <label>
              <span className="text-sm">{type === 'adjustment' ? 'Change (+ or -) *' : 'Quantity *'}</span>
              <input type="number" step="0.001" min={type === 'adjustment' ? undefined : 0.001} value={quantity} onChange={(event) => setQuantity(Number(event.target.value))} className="mt-1 w-full rounded border px-3 py-2" required />
            </label>
            <label>
              <span className="text-sm">Reason *</span>
              <input value={reason} onChange={(event) => setReason(event.target.value)} className="mt-1 w-full rounded border px-3 py-2" required />
            </label>
          </div>
          <div className="mt-4 flex gap-2">
            <button disabled={saving} className="rounded bg-primary px-4 py-2 text-white disabled:opacity-60">{saving ? 'Saving…' : 'Record adjustment'}</button>
            <button type="button" onClick={() => setShowAdjustment(false)} className="rounded border px-4 py-2">Cancel</button>
          </div>
        </form>}

        <section className="mb-8 grid gap-4 sm:grid-cols-3">
          <div className="card">
            <p className="text-sm text-slate-500">Tracked products</p>
            <p className="mt-1 text-2xl font-semibold">{trackedProducts.length}</p>
          </div>
          <div className="card">
            <p className="text-sm text-slate-500">Low stock</p>
            <p className="mt-1 text-2xl font-semibold text-amber-700">{lowStock.length}</p>
          </div>
          <div className="card">
            <p className="text-sm text-slate-500">Out of stock</p>
            <p className="mt-1 text-2xl font-semibold text-red-700">{outOfStock.length}</p>
          </div>
        </section>

        {(canReceive || canWriteOff || canCount) && (
          <section className="mb-8 card">
            <div className="mb-4 flex flex-wrap gap-2">
              {canReceive && <button type="button" onClick={() => setOperation(operation === 'receive' ? null : 'receive')} className={`rounded px-4 py-2 ${operation === 'receive' ? 'bg-primary text-white' : 'border border-primary text-primary'}`}>Receive stock</button>}
              {canWriteOff && <button type="button" onClick={() => setOperation(operation === 'writeoff' ? null : 'writeoff')} className={`rounded px-4 py-2 ${operation === 'writeoff' ? 'bg-primary text-white' : 'border border-primary text-primary'}`}>Write off stock</button>}
              {canCount && <button type="button" onClick={() => setOperation(operation === 'count' ? null : 'count')} className={`rounded px-4 py-2 ${operation === 'count' ? 'bg-primary text-white' : 'border border-primary text-primary'}`}>Stock count</button>}
            </div>

            {operation === 'receive' && canReceive && (
              <form onSubmit={handleReceiveSubmit} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <label>
                    <span className="text-sm">Product *</span>
                    <select value={receiveForm.productId} onChange={(event) => setReceiveForm((current) => ({ ...current, productId: event.target.value }))} className="mt-1 w-full rounded border px-3 py-2" required>
                      <option value="">Select product</option>
                      {trackedProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                    </select>
                  </label>
                  <label>
                    <span className="text-sm">Quantity *</span>
                    <input type="number" min="0.001" step="0.001" value={receiveForm.quantity} onChange={(event) => setReceiveForm((current) => ({ ...current, quantity: Number(event.target.value) }))} className="mt-1 w-full rounded border px-3 py-2" required />
                  </label>
                  <label>
                    <span className="text-sm">Supplier</span>
                    <select value={receiveForm.supplierId} onChange={(event) => setReceiveForm((current) => ({ ...current, supplierId: event.target.value }))} className="mt-1 w-full rounded border px-3 py-2">
                      <option value="">No supplier</option>
                      {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                    </select>
                  </label>
                  {canEnterCostPrice && (
                    <label>
                      <span className="text-sm">Cost price</span>
                      <input type="number" min="0" step="0.01" value={receiveForm.costPrice} onChange={(event) => setReceiveForm((current) => ({ ...current, costPrice: event.target.value }))} className="mt-1 w-full rounded border px-3 py-2" />
                    </label>
                  )}
                  {selectedReceiveProduct?.tracksExpiry && <label className="md:col-span-2 lg:col-span-1">
                    <span className="text-sm">Expiry date *</span>
                    <input type="date" value={receiveForm.expiryDate} onChange={(event) => setReceiveForm((current) => ({ ...current, expiryDate: event.target.value }))} className="mt-1 w-full rounded border px-3 py-2" required />
                  </label>}
                  <label className={selectedReceiveProduct?.tracksExpiry ? 'md:col-span-2 lg:col-span-2' : 'md:col-span-2 lg:col-span-3'}>
                    <span className="text-sm">Reference</span>
                    <input value={receiveForm.reference} onChange={(event) => setReceiveForm((current) => ({ ...current, reference: event.target.value }))} className="mt-1 w-full rounded border px-3 py-2" placeholder="Invoice, GRN, or note" />
                  </label>
                </div>
                <div className="flex gap-2">
                  <button type="submit" disabled={saving} className="rounded bg-primary px-4 py-2 text-white disabled:opacity-60">{saving ? 'Saving…' : 'Receive stock'}</button>
                  <button type="button" onClick={resetOperations} className="rounded border px-4 py-2">Cancel</button>
                </div>
              </form>
            )}

            {operation === 'writeoff' && canWriteOff && (
              <form onSubmit={handleWriteOffSubmit} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <label>
                    <span className="text-sm">Product *</span>
                    <select value={writeOffForm.productId} onChange={(event) => {
                      const nextProductId = event.target.value
                      const nextProduct = trackedProducts.find((product) => product.id === nextProductId) ?? null
                      setWriteOffForm((current) => ({
                        ...current,
                        productId: nextProductId,
                        batchId: nextProduct?.tracksExpiry ? current.batchId : '',
                        quantity: 1
                      }))
                    }} className="mt-1 w-full rounded border px-3 py-2" required>
                      <option value="">Select product</option>
                      {trackedProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                    </select>
                  </label>
                  {selectedWriteOffProduct?.tracksExpiry && (
                    <label>
                      <span className="text-sm">Batch *</span>
                      <select value={writeOffForm.batchId} onChange={(event) => setWriteOffForm((current) => ({ ...current, batchId: event.target.value }))} className="mt-1 w-full rounded border px-3 py-2" required>
                        <option value="">Select batch</option>
                        {batches.filter((batch) => batch.productId === writeOffForm.productId && batch.status === 'active').map((batch) => (
                          <option key={batch.id} value={batch.id}>{batch.batchId} · {batch.quantityRemaining} remaining</option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label>
                    <span className="text-sm">Quantity *</span>
                    <input type="number" min="0.001" step="0.001" max={writeOffMax || undefined} value={writeOffForm.quantity} onChange={(event) => setWriteOffForm((current) => ({ ...current, quantity: Number(event.target.value) }))} className="mt-1 w-full rounded border px-3 py-2" required />
                  </label>
                  <label>
                    <span className="text-sm">Reason *</span>
                    <select value={writeOffForm.reason} onChange={(event) => setWriteOffForm((current) => ({ ...current, reason: event.target.value as (typeof writeOffReasons)[number]['value'] }))} className="mt-1 w-full rounded border px-3 py-2">
                      {writeOffReasons.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
                    </select>
                  </label>
                </div>
                <label>
                  <span className="text-sm">Notes {writeOffForm.reason === 'other' || writeOffForm.reason === 'stock_count_correction' ? '*' : ''}</span>
                  <input value={writeOffForm.notes} onChange={(event) => setWriteOffForm((current) => ({ ...current, notes: event.target.value }))} className="mt-1 w-full rounded border px-3 py-2" placeholder={writeOffForm.reason === 'stock_count_correction' ? 'Explain the count correction.' : 'Add context for this write-off.'} required={writeOffForm.reason === 'other' || writeOffForm.reason === 'stock_count_correction'} />
                </label>
                <div className="flex gap-2">
                  <button type="submit" disabled={saving} className="rounded bg-primary px-4 py-2 text-white disabled:opacity-60">{saving ? 'Saving…' : 'Write off stock'}</button>
                  <button type="button" onClick={resetOperations} className="rounded border px-4 py-2">Cancel</button>
                </div>
              </form>
            )}

            {operation === 'count' && canCount && (
              <form onSubmit={handleStockCountSubmit} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  <label>
                    <span className="text-sm">Product *</span>
                    <select value={stockCountForm.productId} onChange={(event) => {
                      const nextProductId = event.target.value
                      const nextProduct = trackedProducts.find((product) => product.id === nextProductId) ?? null
                      setStockCountForm((current) => ({
                        ...current,
                        productId: nextProductId,
                        countedQuantity: nextProduct ? nextProduct.quantity : 0
                      }))
                    }} className="mt-1 w-full rounded border px-3 py-2" required>
                      <option value="">Select product</option>
                      {trackedProducts.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                    </select>
                  </label>
                  <label>
                    <span className="text-sm">Counted quantity *</span>
                    <input type="number" min="0" step="0.001" value={stockCountForm.countedQuantity} onChange={(event) => setStockCountForm((current) => ({ ...current, countedQuantity: Number(event.target.value) }))} className="mt-1 w-full rounded border px-3 py-2" required />
                  </label>
                  <label className="lg:col-span-2">
                    <span className="text-sm">Reason *</span>
                    <input value={stockCountForm.reason} onChange={(event) => setStockCountForm((current) => ({ ...current, reason: event.target.value }))} className="mt-1 w-full rounded border px-3 py-2" required />
                  </label>
                </div>
                <label>
                  <span className="text-sm">Notes</span>
                  <input value={stockCountForm.notes} onChange={(event) => setStockCountForm((current) => ({ ...current, notes: event.target.value }))} className="mt-1 w-full rounded border px-3 py-2" placeholder="Optional count details" />
                </label>
                {selectedCountProduct && <div className="rounded bg-slate-50 p-3 text-sm text-slate-600">
                  Current on-hand: <span className="font-semibold">{selectedCountProduct.quantity}</span>
                  {stockCountForm.countedQuantity !== selectedCountProduct.quantity && (
                    <span className="ml-2">Variance: <span className="font-semibold">{stockCountForm.countedQuantity - selectedCountProduct.quantity}</span></span>
                  )}
                </div>}
                <div className="flex gap-2">
                  <button type="submit" disabled={saving} className="rounded bg-primary px-4 py-2 text-white disabled:opacity-60">{saving ? 'Saving…' : 'Save stock count'}</button>
                  <button type="button" onClick={resetOperations} className="rounded border px-4 py-2">Cancel</button>
                </div>
              </form>
            )}
          </section>
        )}

        <section className="mb-8">
          <h2 className="mb-3 text-lg font-semibold">Current stock</h2>
          {trackedProducts.length === 0 ? (
            <EmptyState title="No tracked products" description="Enable stock tracking on a product to manage its inventory." />
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-white">
              <table className="w-full min-w-[600px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-3">Product</th>
                    <th className="p-3">On hand</th>
                    <th className="p-3">Reorder level</th>
                    <th className="p-3">Stock status</th>
                  </tr>
                </thead>
                <tbody>
                  {trackedProducts.map((product) => {
                    const status = getProductStockStatus(product)
                    return (
                      <tr key={product.id} className="border-t">
                        <td className="p-3 font-medium">{product.name}</td>
                        <td className="p-3">{product.quantity} {product.unit}</td>
                        <td className="p-3">{product.reorderLevel}</td>
                        <td className={`p-3 ${status === 'out_of_stock' ? 'text-red-700' : status === 'low_stock' ? 'text-amber-700' : 'text-green-700'}`}>
                          {status.replace(/_/g, ' ')}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Movement history</h2>
          {movementPage.items.length === 0 ? (
            <EmptyState title="No inventory movements" description="Opening stock, sales, and adjustments will appear here." />
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-white">
              <table className="w-full min-w-[1100px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-3">Date</th>
                    <th className="p-3">Product</th>
                    <th className="p-3">Type</th>
                    <th className="p-3">Change</th>
                    <th className="p-3">Balance</th>
                    <th className="p-3">Reason</th>
                    <th className="p-3">Recipe / batch</th>
                    <th className="p-3">Staff</th>
                  </tr>
                </thead>
                <tbody>
                  {movementPage.items.map((movement) => (
                    <tr key={movement.id} className="border-t">
                      <td className="p-3 text-slate-600">{formatDateTime(movement.createdAt)}</td>
                      <td className="p-3 font-medium">{movement.productName}</td>
                      <td className="p-3">{inventoryMovementLabel(movement)}</td>
                      <td className={`p-3 font-medium ${movement.quantityChange < 0 ? 'text-red-700' : 'text-green-700'}`}>
                        {movement.quantityChange > 0 ? '+' : ''}{movement.quantityChange}
                      </td>
                      <td className="p-3">{movement.quantityBefore} → {movement.quantityAfter}</td>
                      <td className="p-3">{movement.reason}</td>
                      <td className="p-3 text-xs text-slate-600">{movement.menuItems?.map((item) => `${item.productName} (v${item.recipeVersion})`).join(', ') || '—'}{movement.batchAllocations?.length ? <div>Batches: {movement.batchAllocations.map((batch) => batch.batchId).join(', ')}</div> : null}</td>
                      <td className="p-3">{movement.staffNameSnapshot || movement.createdBy}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {movementPage.hasMore && (
            <div className="mt-4 text-center">
              <button onClick={() => void movementPage.loadMore()} disabled={movementPage.loadingMore} className="rounded border px-4 py-2 disabled:opacity-50">
                {movementPage.loadingMore ? 'Loading…' : 'Load more movements'}
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
