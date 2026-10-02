import { useEffect, useMemo, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import EmptyState from '../components/feedback/EmptyState'
import ErrorMessage from '../components/feedback/ErrorMessage'
import LoadingScreen from '../components/feedback/LoadingScreen'
import PageHeader from '../components/layout/PageHeader'
import { requireFirebase } from '../config/firebase'
import { useAuth } from '../hooks/useAuth'
import type { Promotion, PromotionInput, PromotionType } from '../models/promotion'
import type { Product } from '../models/product'
import { createFirestoreProductRepository } from '../services/products'
import { getFirebaseErrorMessage } from '../utils/firebaseErrors'
import { formatDateTime, formatZar } from '../utils/format'

type PromotionStatusInput = PromotionInput['status']

type PromotionFormState = {
  id: string
  name: string
  description: string
  type: PromotionType
  value: string
  productId: string
  category: string
  maxDiscountAmount: string
  status: PromotionStatusInput
  startsAt: string
  endsAt: string
}

const PAGE_SIZE = 40
const emptyForm = (): PromotionFormState => ({
  id: '',
  name: '',
  description: '',
  type: 'percentage',
  value: '10',
  productId: '',
  category: '',
  maxDiscountAmount: '',
  status: 'active',
  startsAt: '',
  endsAt: ''
})

function toDateTimeInput(value?: number | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset()
  const local = new Date(date.getTime() - offset * 60000)
  return local.toISOString().slice(0, 16)
}

function fromDateTimeInput(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Choose valid start and end dates.')
  }
  return parsed.getTime()
}

export default function Promotions() {
  const { business, user, hasPermission } = useAuth()
  const canManage = hasPermission('manage_promotions')
  const { functions } = requireFirebase()

  const productsRepository = useMemo(() => business && user ? createFirestoreProductRepository(business.id, user.uid) : null, [business, user])
  const listPromotions = useMemo(
    () => httpsCallable<{ cursorUpdatedAt?: number | null; cursorId?: string | null; pageSize?: number }, { items: Promotion[]; cursor: { updatedAt: number; id: string } | null; hasMore: boolean }>(functions, 'listPromotions'),
    [functions]
  )
  const savePromotion = useMemo(
    () => httpsCallable<PromotionInput, { id: string; status: PromotionInput['status'] }>(functions, 'savePromotion'),
    [functions]
  )
  const setPromotionStatus = useMemo(
    () => httpsCallable<{ id: string; status: PromotionInput['status'] }, { ok: boolean }>(functions, 'setPromotionStatus'),
    [functions]
  )

  const [items, setItems] = useState<Promotion[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingProducts, setLoadingProducts] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [cursor, setCursor] = useState<{ updatedAt: number; id: string } | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<PromotionFormState>(emptyForm())

  useEffect(() => {
    if (!productsRepository) {
      setLoadingProducts(false)
      return
    }
    const unsubscribeProducts = productsRepository.subscribe(
      (data) => {
        setProducts(data.filter((product) => product.status === 'active'))
        setLoadingProducts(false)
      },
      (loadError) => {
        setError(getFirebaseErrorMessage(loadError, 'Unable to load products for promotions.'))
        setLoadingProducts(false)
      }
    )
    return () => { unsubscribeProducts() }
  }, [productsRepository])

  useEffect(() => {
    let active = true
    const run = async () => {
      setLoading(true)
      try {
        const response = await listPromotions({ pageSize: PAGE_SIZE })
        if (!active) return
        setItems(response.data.items)
        setCursor(response.data.cursor)
        setHasMore(response.data.hasMore)
      } catch (loadError) {
        if (!active) return
        setError(getFirebaseErrorMessage(loadError, 'Unable to load promotions.'))
      } finally {
        if (active) setLoading(false)
      }
    }

    void run()
    return () => { active = false }
  }, [listPromotions])

  const categories = useMemo<string[]>(
    () => Array.from(new Set(products.map((product) => product.category).filter((category): category is string => Boolean(category)))).sort((a, b) => a.localeCompare(b)),
    [products]
  )

  const loadMore = async () => {
    if (!cursor) return
    try {
      const response = await listPromotions({ cursorUpdatedAt: cursor.updatedAt, cursorId: cursor.id, pageSize: PAGE_SIZE })
      setItems((current) => [...current, ...response.data.items])
      setCursor(response.data.cursor)
      setHasMore(response.data.hasMore)
    } catch (loadError) {
      setError(getFirebaseErrorMessage(loadError, 'Unable to load more promotions.'))
    }
  }

  const resetForm = () => {
    setForm(emptyForm())
    setShowForm(false)
  }

  const handleEdit = (promotion: Promotion) => {
    setForm({
      id: promotion.id,
      name: promotion.name,
      description: promotion.description,
      type: promotion.type,
      value: String(promotion.value),
      productId: promotion.productId ?? '',
      category: promotion.category ?? '',
      maxDiscountAmount: promotion.maxDiscountAmount == null ? '' : String(promotion.maxDiscountAmount),
      status: promotion.status === 'scheduled' || promotion.status === 'expired' ? 'disabled' : promotion.status,
      startsAt: toDateTimeInput(promotion.startsAt),
      endsAt: toDateTimeInput(promotion.endsAt)
    })
    setShowForm(true)
    setError(null)
    setSuccess(null)
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!canManage) return
    setSaving(true)
    setError(null)
    setSuccess(null)

    try {
      const startsAt = fromDateTimeInput(form.startsAt)
      const endsAt = fromDateTimeInput(form.endsAt)
      if (endsAt <= startsAt) {
        throw new Error('Promotion end date must be after the start date.')
      }

      const payload = {
        id: form.id || undefined,
        name: form.name.trim(),
        description: form.description.trim(),
        type: form.type,
        value: Number(form.value),
        productId: form.type === 'product_percentage' && form.productId ? form.productId : null,
        category: form.type === 'category_percentage' && form.category ? form.category : null,
        maxDiscountAmount: form.maxDiscountAmount.trim() === '' ? null : Number(form.maxDiscountAmount),
        status: form.status,
        startsAt,
        endsAt
      }

      if (!payload.name) throw new Error('Promotion name is required.')
      if (!Number.isFinite(payload.value) || payload.value <= 0) throw new Error('Promotion value is invalid.')
      if (payload.type !== 'fixed' && payload.value > 100) throw new Error('Percentage promotions cannot exceed 100%.')
      if (payload.type === 'product_percentage' && !payload.productId) throw new Error('Choose a product for this promotion.')
      if (payload.type === 'category_percentage' && !payload.category) throw new Error('Choose a category for this promotion.')
      if (payload.maxDiscountAmount != null && (!Number.isFinite(payload.maxDiscountAmount) || payload.maxDiscountAmount <= 0)) {
        throw new Error('Maximum discount must be a valid positive number.')
      }

      const savePayload = {
        ...payload,
        status: payload.status as PromotionStatusInput
      }

      await savePromotion(savePayload)
      setSuccess(form.id ? 'Promotion updated.' : 'Promotion created.')
      resetForm()
      const refreshed = await listPromotions({ pageSize: PAGE_SIZE })
      setItems(refreshed.data.items)
      setCursor(refreshed.data.cursor)
      setHasMore(refreshed.data.hasMore)
    } catch (saveError) {
      setError(getFirebaseErrorMessage(saveError, saveError instanceof Error ? saveError.message : 'Unable to save the promotion.'))
    } finally {
      setSaving(false)
    }
  }

  const handleStatusChange = async (promotion: Promotion, nextStatus: PromotionStatusInput) => {
    if (!canManage) return
    setError(null)
    setSuccess(null)
    try {
      await setPromotionStatus({ id: promotion.id, status: nextStatus })
      setSuccess(`Promotion marked as ${nextStatus}.`)
      const refreshed = await listPromotions({ pageSize: PAGE_SIZE })
      setItems(refreshed.data.items)
      setCursor(refreshed.data.cursor)
      setHasMore(refreshed.data.hasMore)
    } catch (saveError) {
      setError(getFirebaseErrorMessage(saveError, saveError instanceof Error ? saveError.message : 'Unable to update the promotion status.'))
    }
  }

  if (loading || loadingProducts) return <LoadingScreen message="Loading promotions…" />

  return (
    <main className="p-4 md:p-6">
      <div className="mx-auto max-w-7xl">
        <PageHeader
          title="Promotions"
          description="Manage tenant promotions and review active discount campaigns."
          action={canManage ? <button onClick={() => { setForm(emptyForm()); setShowForm((current) => !current) }} className="rounded bg-primary px-4 py-2 text-white">{showForm ? 'Close form' : 'New promotion'}</button> : undefined}
        />

        {error && <ErrorMessage message={error} />}
        {success && <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700" role="status">{success}</div>}

        {canManage && showForm && (
          <form onSubmit={handleSubmit} className="card mb-8 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">{form.id ? 'Edit promotion' : 'Create promotion'}</h2>
              {form.id && <button type="button" onClick={resetForm} className="text-sm text-slate-500 underline">Discard</button>}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label>
                <span className="text-sm">Name *</span>
                <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className="mt-1 w-full rounded border px-3 py-2" required />
              </label>
              <label>
                <span className="text-sm">Status</span>
                <select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value as PromotionFormState['status'] }))} className="mt-1 w-full rounded border px-3 py-2">
                  <option value="draft">Draft</option>
                  <option value="active">Active</option>
                  <option value="disabled">Disabled</option>
                </select>
              </label>
            </div>

            <label>
              <span className="text-sm">Description</span>
              <input value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} className="mt-1 w-full rounded border px-3 py-2" />
            </label>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <label>
                <span className="text-sm">Type</span>
                <select value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value as PromotionType }))} className="mt-1 w-full rounded border px-3 py-2">
                  <option value="percentage">Percentage</option>
                  <option value="fixed">Fixed amount</option>
                  <option value="product_percentage">Product percentage</option>
                  <option value="category_percentage">Category percentage</option>
                </select>
              </label>
              <label>
                <span className="text-sm">Value *</span>
                <input type="number" min="0" step="0.01" value={form.value} onChange={(event) => setForm((current) => ({ ...current, value: event.target.value }))} className="mt-1 w-full rounded border px-3 py-2" required />
              </label>
              <label>
                <span className="text-sm">Max discount (optional)</span>
                <input type="number" min="0" step="0.01" value={form.maxDiscountAmount} onChange={(event) => setForm((current) => ({ ...current, maxDiscountAmount: event.target.value }))} className="mt-1 w-full rounded border px-3 py-2" />
              </label>
              <label>
                <span className="text-sm">Starts</span>
                <input type="datetime-local" value={form.startsAt} onChange={(event) => setForm((current) => ({ ...current, startsAt: event.target.value }))} className="mt-1 w-full rounded border px-3 py-2" required />
              </label>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {form.type === 'product_percentage' && (
                <label>
                  <span className="text-sm">Product *</span>
                  <select value={form.productId} onChange={(event) => setForm((current) => ({ ...current, productId: event.target.value }))} className="mt-1 w-full rounded border px-3 py-2">
                    <option value="">Select product</option>
                    {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                  </select>
                </label>
              )}

              {form.type === 'category_percentage' && (
                <label>
                  <span className="text-sm">Category *</span>
                  <select value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} className="mt-1 w-full rounded border px-3 py-2">
                    <option value="">Select category</option>
                    {categories.map((category) => <option key={category} value={category}>{category}</option>)}
                  </select>
                </label>
              )}

              <label>
                <span className="text-sm">Ends</span>
                <input type="datetime-local" value={form.endsAt} onChange={(event) => setForm((current) => ({ ...current, endsAt: event.target.value }))} className="mt-1 w-full rounded border px-3 py-2" required />
              </label>
            </div>

            <div className="flex gap-2">
              <button type="submit" disabled={saving} className="rounded bg-primary px-4 py-2 text-white disabled:opacity-60">
                {saving ? 'Saving…' : form.id ? 'Update promotion' : 'Create promotion'}
              </button>
              <button type="button" onClick={resetForm} className="rounded border px-4 py-2">Cancel</button>
            </div>
          </form>
        )}

        <section>
          <h2 className="mb-3 text-lg font-semibold">Promotion catalog</h2>

          {items.length === 0 ? (
            <EmptyState
              title="No promotions"
              description="Create a promotion rule to enable tenant discounts for eligible products."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-white">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-3">Name</th>
                    <th className="p-3">Type</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Value</th>
                    <th className="p-3">Date range</th>
                    <th className="p-3">Eligibility</th>
                    {canManage && <th className="p-3">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {items.map((promotion) => (
                    <tr key={promotion.id} className="border-t align-top">
                      <td className="p-3">
                        <div className="font-medium">{promotion.name}</div>
                        <div className="text-xs text-slate-500">{promotion.description || 'No description'}</div>
                      </td>
                      <td className="p-3 capitalize">{promotion.type.replace(/_/g, ' ')}</td>
                      <td className="p-3">
                        <span className={`rounded-full px-2 py-1 text-xs font-medium ${promotion.status === 'active' ? 'bg-emerald-100 text-emerald-700' : promotion.status === 'expired' ? 'bg-red-100 text-red-700' : promotion.status === 'draft' ? 'bg-slate-200 text-slate-700' : 'bg-amber-100 text-amber-700'}`}>
                          {promotion.status}
                        </span>
                      </td>
                      <td className="p-3">{promotion.type === 'fixed' ? formatZar(promotion.value) : `${promotion.value}%`}</td>
                      <td className="p-3">{formatDateTime(promotion.startsAt)} → {formatDateTime(promotion.endsAt)}</td>
                      <td className="p-3">
                        {promotion.type === 'product_percentage' ? `Product ${promotion.productId ?? '—'}` : promotion.type === 'category_percentage' ? `Category ${promotion.category ?? '—'}` : 'All items'}
                      </td>
                      {canManage && (
                        <td className="p-3">
                          <div className="flex flex-col gap-2">
                            <button type="button" onClick={() => handleEdit(promotion)} className="text-left text-primary underline">Edit</button>
                            {promotion.status !== 'active' ? (
                              <button type="button" onClick={() => void handleStatusChange(promotion, 'active')} className="text-left text-emerald-700 underline">Activate</button>
                            ) : (
                              <button type="button" onClick={() => void handleStatusChange(promotion, 'disabled')} className="text-left text-amber-700 underline">Disable</button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {hasMore && (
            <div className="mt-4 text-center">
              <button onClick={() => void loadMore()} className="rounded border px-4 py-2">
                Load more promotions
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
