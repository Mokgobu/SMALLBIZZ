import { useMemo, useState } from 'react'
import ConfirmationDialog from '../components/feedback/ConfirmationDialog'
import EmptyState from '../components/feedback/EmptyState'
import ErrorMessage from '../components/feedback/ErrorMessage'
import LoadingScreen from '../components/feedback/LoadingScreen'
import ProductForm from '../components/forms/ProductForm'
import PageHeader from '../components/layout/PageHeader'
import { getProductStockStatus } from '../domain/commerce'
import { useAuth } from '../hooks/useAuth'
import { usePagedData } from '../hooks/usePagedData'
import type { Product, ProductInput, ProductStatus } from '../models/product'
import { createFirestoreProductRepository } from '../services/products'
import { createOperationalProductRepository } from '../services/operations'
import { getFirebaseErrorMessage } from '../utils/firebaseErrors'
import { formatZar } from '../utils/format'

const stockLabels = { in_stock: 'In stock', low_stock: 'Low stock', out_of_stock: 'Out of stock', not_tracked: 'Not tracked' }

export default function Products() {
  const { business, user, hasPermission } = useAuth()
  const canManage = hasPermission('manage_products')
  const repository = useMemo(() => business && user
    ? canManage ? createFirestoreProductRepository(business.id, user.uid) : createOperationalProductRepository()
    : null, [business, user, canManage])
  const page = usePagedData(repository ? repository.listPage : null, 'Unable to load products.')
  const products = page.items
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [status, setStatus] = useState<ProductStatus | 'all'>('active')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Product | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<Product | null>(null)
  const [archiving, setArchiving] = useState(false)

  const categories = [...new Set(products.map((product) => product.category).filter(Boolean))].sort()
  const filtered = products.filter((product) => {
    const term = search.trim().toLowerCase()
    const matchesSearch = !term || [product.name, product.sku, product.barcode].some((value) => value.toLowerCase().includes(term))
    return matchesSearch && (category === 'all' || product.category === category) && (status === 'all' || product.status === status)
  })

  const saveProduct = async (input: ProductInput) => {
    if (!repository) return
    if (editing) await repository.update(editing.id, input)
    else await repository.create(input)
    await page.reload()
    setEditing(null)
    setShowForm(false)
  }

  const changeStatus = async () => {
    if (!repository || !archiveTarget) return
    setArchiving(true)
    try { await repository.setStatus(archiveTarget.id, 'archived'); setArchiveTarget(null); await page.reload() }
    catch (saveError) { page.setError(getFirebaseErrorMessage(saveError, 'Unable to archive the product.')) }
    finally { setArchiving(false) }
  }

  const restoreProduct = async (product: Product) => {
    if (!repository) return
    page.setError(null)
    try { await repository.setStatus(product.id, 'active'); await page.reload() }
    catch (saveError) { page.setError(getFirebaseErrorMessage(saveError, 'Unable to restore the product.')) }
  }

  if (page.loading) return <LoadingScreen message="Loading products…" />

  return (
    <main className="p-4 md:p-6">
      <div className="mx-auto max-w-7xl">
        <PageHeader title="Products" description={canManage ? 'Manage prices, product details, and stock thresholds.' : 'View the current product catalogue and selling prices.'} action={canManage ? <button onClick={() => { setEditing(null); setShowForm(true) }} className="rounded bg-primary px-4 py-2 text-white">Add product</button> : undefined} />
        {page.error && <ErrorMessage message={page.error} />}
        {canManage && showForm && <ProductForm key={editing?.id ?? 'new'} product={editing} onSave={saveProduct} onCancel={() => { setShowForm(false); setEditing(null) }} />}

        <div className="mb-4 grid gap-3 rounded-lg border bg-white p-4 md:grid-cols-3">
          <input value={search} onChange={(event) => setSearch(event.target.value)} className="rounded border px-3 py-2" placeholder="Search name, SKU, or barcode" />
          <select value={category} onChange={(event) => setCategory(event.target.value)} className="rounded border px-3 py-2"><option value="all">All categories</option>{categories.map((value) => <option key={value}>{value}</option>)}</select>
          <select value={status} onChange={(event) => setStatus(event.target.value as ProductStatus | 'all')} className="rounded border px-3 py-2"><option value="active">Active</option><option value="archived">Archived</option><option value="all">All statuses</option></select>
        </div>

        {filtered.length === 0 ? <EmptyState title="No products found" description={products.length ? 'Try changing the search or filters.' : 'Add your first product to start managing inventory and sales.'} /> : (
          <div className="overflow-x-auto rounded-lg border bg-white">
            <table className="w-full min-w-[850px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Product</th><th className="p-3">Category</th><th className="p-3">Selling</th>{canManage && <th className="p-3">Cost</th>}<th className="p-3">Stock</th><th className="p-3">Status</th>{canManage && <th className="p-3 text-right">Actions</th>}</tr></thead>
              <tbody>{filtered.map((product) => { const stock = getProductStockStatus(product); return <tr key={product.id} className="border-t"><td className="p-3"><div className="font-medium">{product.name}</div><div className="text-xs text-slate-500">{product.sku || 'No SKU'}</div></td><td className="p-3">{product.category || '—'}</td><td className="p-3">{formatZar(product.sellingPrice)}</td>{canManage && <td className="p-3">{formatZar(product.costPrice)}</td>}<td className="p-3"><span className={stock === 'out_of_stock' ? 'font-medium text-red-700' : stock === 'low_stock' ? 'font-medium text-amber-700' : ''}>{product.trackStock ? `${product.quantity} ${product.unit}` : stockLabels[stock]}</span><div className="text-xs text-slate-500">{product.trackStock ? stockLabels[stock] : ''}</div></td><td className="p-3 capitalize">{product.status}</td>{canManage && <td className="p-3 text-right"><button onClick={() => { setEditing(product); setShowForm(true) }} className="mr-3 text-primary underline">Edit</button>{product.status === 'active' ? <button onClick={() => setArchiveTarget(product)} className="text-red-700 underline">Archive</button> : <button onClick={() => void restoreProduct(product)} className="text-primary underline">Restore</button>}</td>}</tr> })}</tbody>
            </table>
          </div>
        )}
        {page.hasMore && <div className="mt-4 text-center"><button onClick={() => void page.loadMore()} disabled={page.loadingMore} className="rounded border px-4 py-2 disabled:opacity-50">{page.loadingMore ? 'Loading…' : 'Load more products'}</button></div>}
        <p className="mt-3 text-xs text-slate-500">Search and filters apply to loaded products. Load more to search additional records.</p>
      </div>
      <ConfirmationDialog open={Boolean(archiveTarget)} title="Archive product?" message={`${archiveTarget?.name ?? 'This product'} will no longer be available for new sales. Its history will remain intact.`} confirmLabel="Archive" busy={archiving} onConfirm={() => void changeStatus()} onCancel={() => setArchiveTarget(null)} />
    </main>
  )
}
