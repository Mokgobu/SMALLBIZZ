import { useState } from 'react'
import type { Product, ProductInput } from '../../models/product'
import ErrorMessage from '../feedback/ErrorMessage'
import { SUPPORTED_UNITS } from '../../domain/units'

const emptyProduct: ProductInput = {
  name: '', description: '', sku: '', barcode: '', category: '', sellingPrice: 0,
  costPrice: 0, quantity: 0, reorderLevel: 0, trackStock: true, tracksExpiry: false,
  shelfLifeDays: null, expiryWarningDays: 7, expiryCriticalDays: 3, unit: 'each',
  productClass: 'inventory_item', menuItem: false, recipeId: null, isIngredient: false
}

export default function ProductForm({ product, onSave, onCancel }: {
  product?: Product | null
  onSave: (input: ProductInput) => Promise<void>
  onCancel: () => void
}) {
  const [form, setForm] = useState<ProductInput>(product ? {
    name: product.name,
    description: product.description,
    sku: product.sku,
    barcode: product.barcode,
    category: product.category,
    sellingPrice: product.sellingPrice,
    costPrice: product.costPrice,
    quantity: product.quantity,
    reorderLevel: product.reorderLevel,
    trackStock: product.trackStock,
    tracksExpiry: product.tracksExpiry ?? false,
    shelfLifeDays: product.shelfLifeDays ?? null,
    expiryWarningDays: product.expiryWarningDays ?? 7,
    expiryCriticalDays: product.expiryCriticalDays ?? 3,
    unit: product.unit,
    productClass: product.productClass ?? 'inventory_item',
    menuItem: Boolean(product.menuItem),
    recipeId: product.recipeId ?? null,
    isIngredient: Boolean(product.isIngredient)
  } : emptyProduct)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const classification = form.productClass === 'menu_item' || form.menuItem ? 'menu_item' : form.productClass === 'service' ? 'service' : form.isIngredient && form.productClass !== 'ingredient' ? 'sellable_ingredient' : form.productClass === 'ingredient' || form.isIngredient ? 'ingredient' : 'inventory_item'

  const set = <K extends keyof ProductInput>(key: K, value: ProductInput[K]) => setForm((current) => ({ ...current, [key]: value }))
  const setClassification = (value: string) => setForm((current) => ({
    ...current,
    productClass: value === 'sellable_ingredient' ? 'inventory_item' : value as ProductInput['productClass'],
    menuItem: value === 'menu_item',
    isIngredient: value === 'ingredient' || value === 'sellable_ingredient',
    trackStock: value === 'service' || value === 'menu_item' ? false : current.trackStock,
    tracksExpiry: value === 'service' || value === 'menu_item' ? false : current.tracksExpiry
  }))
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try { await onSave(form) } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save the product.')
    } finally { setSaving(false) }
  }

  return (
    <form onSubmit={save} className="card mb-6">
      <h2 className="mb-4 text-lg font-semibold">{product ? 'Edit product' : 'Add product'}</h2>
      {error && <ErrorMessage message={error} />}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <label><span className="text-sm">Name *</span><input className="mt-1 w-full rounded border px-3 py-2" value={form.name} onChange={(event) => set('name', event.target.value)} required /></label>
        <label><span className="text-sm">SKU</span><input className="mt-1 w-full rounded border px-3 py-2" value={form.sku} onChange={(event) => set('sku', event.target.value)} /></label>
        <label><span className="text-sm">Barcode</span><input className="mt-1 w-full rounded border px-3 py-2" value={form.barcode} onChange={(event) => set('barcode', event.target.value)} /></label>
        <label><span className="text-sm">Category</span><input className="mt-1 w-full rounded border px-3 py-2" value={form.category} onChange={(event) => set('category', event.target.value)} /></label>
        <label><span className="text-sm">Selling price (ZAR) *</span><input type="number" min="0" step="0.01" className="mt-1 w-full rounded border px-3 py-2" value={form.sellingPrice} onChange={(event) => set('sellingPrice', Number(event.target.value))} required /></label>
        <label><span className="text-sm">Cost price (ZAR) *</span><input type="number" min="0" step="0.01" className="mt-1 w-full rounded border px-3 py-2" value={form.costPrice} onChange={(event) => set('costPrice', Number(event.target.value))} required /></label>
        <label><span className="text-sm">Classification</span><select className="mt-1 w-full rounded border px-3 py-2" value={classification} onChange={(event) => setClassification(event.target.value)}><option value="inventory_item">Sellable item</option><option value="ingredient">Ingredient</option><option value="menu_item">Menu item</option><option value="sellable_ingredient">Sellable + ingredient</option><option value="service">Non-stock / service</option></select></label>
        <label><span className="text-sm">Stock unit</span><select className="mt-1 w-full rounded border px-3 py-2" value={form.unit} onChange={(event) => set('unit', event.target.value)}>{!SUPPORTED_UNITS.some((unit) => unit.id === form.unit) && <option value={form.unit}>{form.unit}</option>}{SUPPORTED_UNITS.map((unit) => <option key={unit.id} value={unit.id}>{unit.label} ({unit.symbol})</option>)}</select></label>
        <label className="flex items-center gap-2 pt-6"><input type="checkbox" checked={form.trackStock} onChange={(event) => set('trackStock', event.target.checked)} /> Track stock</label>
        {form.trackStock && <label className="flex items-center gap-2 pt-6"><input type="checkbox" checked={form.tracksExpiry} onChange={(event) => set('tracksExpiry', event.target.checked)} /> Track expiry batches</label>}
        {form.trackStock && form.tracksExpiry && <label><span className="text-sm">Shelf life (days, optional)</span><input type="number" min="0" step="1" value={form.shelfLifeDays ?? ''} onChange={(event) => set('shelfLifeDays', event.target.value === '' ? null : Number(event.target.value))} className="mt-1 w-full rounded border px-3 py-2" /></label>}
        {form.trackStock && form.tracksExpiry && <label><span className="text-sm">Warning window (days)</span><input type="number" min="0" step="1" value={form.expiryWarningDays} onChange={(event) => set('expiryWarningDays', Number(event.target.value))} className="mt-1 w-full rounded border px-3 py-2" /></label>}
        {form.trackStock && form.tracksExpiry && <label><span className="text-sm">Critical window (days)</span><input type="number" min="0" step="1" value={form.expiryCriticalDays} onChange={(event) => set('expiryCriticalDays', Number(event.target.value))} className="mt-1 w-full rounded border px-3 py-2" /></label>}
        {form.trackStock && <label><span className="text-sm">{product ? 'Current stock (use Inventory to change)' : 'Opening stock'}</span><input type="number" min="0" step="0.001" disabled={Boolean(product)} className="mt-1 w-full rounded border px-3 py-2 disabled:bg-slate-100" value={form.quantity} onChange={(event) => set('quantity', Number(event.target.value))} /></label>}
        {form.trackStock && <label><span className="text-sm">Reorder level</span><input type="number" min="0" step="0.001" className="mt-1 w-full rounded border px-3 py-2" value={form.reorderLevel} onChange={(event) => set('reorderLevel', Number(event.target.value))} /></label>}
        <label className="md:col-span-2 lg:col-span-3"><span className="text-sm">Description</span><textarea className="mt-1 w-full rounded border px-3 py-2" rows={2} value={form.description} onChange={(event) => set('description', event.target.value)} /></label>
      </div>
      <div className="mt-5 flex gap-2"><button disabled={saving} className="rounded bg-primary px-4 py-2 text-white disabled:opacity-60">{saving ? 'Saving…' : 'Save product'}</button><button type="button" onClick={onCancel} className="rounded border px-4 py-2">Cancel</button></div>
    </form>
  )
}
