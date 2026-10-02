import { useEffect, useMemo, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import EmptyState from '../components/feedback/EmptyState'
import ErrorMessage from '../components/feedback/ErrorMessage'
import LoadingScreen from '../components/feedback/LoadingScreen'
import PageHeader from '../components/layout/PageHeader'
import SaleReceipt from '../components/sales/SaleReceipt'
import { requireFirebase } from '../config/firebase'
import { prepareSale } from '../domain/commerce'
import { promotionStatus } from '../domain/promotions'
import { useAuth } from '../hooks/useAuth'
import { usePagedData } from '../hooks/usePagedData'
import type { Customer } from '../models/customer'
import type { Product } from '../models/product'
import type { Promotion } from '../models/promotion'
import { PAYMENT_METHODS, type PaymentMethod, type Sale, type SaleRequestLine } from '../models/sale'
import { createFirestoreCustomerRepository } from '../services/customers'
import { createFirestoreProductRepository } from '../services/products'
import { createFirestoreSalesRepository } from '../services/sales'
import { createOperationalProductRepository, createOperationalSalesRepository } from '../services/operations'
import { createRestaurantService } from '../services/restaurant'
import type { MenuAvailability, ModifierGroup } from '../models/recipe'
import { getFirebaseErrorMessage } from '../utils/firebaseErrors'
import { formatDateTime, formatZar } from '../utils/format'

export default function Sales() {
  const { business, user, hasPermission } = useAuth()
  const canCreate = hasPermission('create_sale')
  const canViewFinancials = hasPermission('view_reports')
  const canApplyManualDiscount = hasPermission('apply_manual_discount')
  const { functions } = requireFirebase()

  const repositories = useMemo(() => {
    if (!business || !user) return null
    const directSales = createFirestoreSalesRepository(business.id, user.uid)
    return {
      products: canViewFinancials ? createFirestoreProductRepository(business.id, user.uid) : createOperationalProductRepository(),
      sales: canViewFinancials ? directSales : createOperationalSalesRepository(directSales.record),
      customers: createFirestoreCustomerRepository(business.id, user.uid)
    }
  }, [business, user, canViewFinancials])

  const listPromotions = useMemo(
    () => httpsCallable<Record<string, never>, { items: Promotion[] }>(functions, 'listPromotions'),
    [functions]
  )
  const restaurantService = useMemo(() => createRestaurantService(), [])

  const salesPage = usePagedData(repositories ? repositories.sales.listPage : null, 'Unable to load sales history.')
  const [products, setProducts] = useState<Product[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [availablePromotions, setAvailablePromotions] = useState<Promotion[]>([])
  const [loadingProducts, setLoadingProducts] = useState(true)
  const [loadingCustomers, setLoadingCustomers] = useState(true)
  const [loadingPromotions, setLoadingPromotions] = useState(true)
  const [loadingMenu, setLoadingMenu] = useState(true)
  const [menuCatalog, setMenuCatalog] = useState<Array<MenuAvailability & { modifierGroups?: ModifierGroup[] }>>([])
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [lines, setLines] = useState<SaleRequestLine[]>([])
  const [selectedProductId, setSelectedProductId] = useState('')
  const [promotionId, setPromotionId] = useState('')
  const [discount, setDiscount] = useState(0)
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash')
  const [notes, setNotes] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [saving, setSaving] = useState(false)
  const [receipt, setReceipt] = useState<Sale | null>(null)

  useEffect(() => {
    if (!repositories) return
    const unsubscribeProducts = repositories.products.subscribe(
      (data) => { setProducts(data); setLoadingProducts(false) },
      (loadError) => { setError(getFirebaseErrorMessage(loadError, 'Unable to load products.')); setLoadingProducts(false) }
    )
    const unsubscribeCustomers = repositories.customers.subscribe(
      (data) => { setCustomers(data); setLoadingCustomers(false) },
      (loadError) => { setError(getFirebaseErrorMessage(loadError, 'Unable to load customers.')); setLoadingCustomers(false) }
    )
    return () => { unsubscribeProducts(); unsubscribeCustomers() }
  }, [repositories])

  useEffect(() => {
    let active = true
    const run = async () => {
      setLoadingPromotions(true)
      try {
        const response = await listPromotions({})
        if (!active) return
        setAvailablePromotions(response.data.items.filter((promotion) => promotionStatus(promotion, Date.now()) === 'active'))
      } catch (loadError) {
        if (!active) return
        setError(getFirebaseErrorMessage(loadError, 'Unable to load promotions for the sale form.'))
      } finally {
        if (active) setLoadingPromotions(false)
      }
    }

    void run()
    return () => { active = false }
  }, [listPromotions])

  useEffect(() => {
    let active = true
    void restaurantService.getMenuCatalog()
      .then((items) => { if (active) setMenuCatalog(items) })
      .catch((loadError) => { if (active) setError(getFirebaseErrorMessage(loadError, 'Unable to load menu availability.')) })
      .finally(() => { if (active) setLoadingMenu(false) })
    return () => { active = false }
  }, [restaurantService])

  const activeProducts = products.filter((product) => product.status === 'active')
  const selectedProducts = lines.map((line) => ({ line, product: products.find((product) => product.id === line.productId) })).filter((entry): entry is { line: SaleRequestLine; product: Product } => Boolean(entry.product))
  const selectedPromotion = useMemo(
    () => availablePromotions.find((promotion) => promotion.id === promotionId) ?? null,
    [availablePromotions, promotionId]
  )
  const effectiveDiscount = canApplyManualDiscount ? discount : 0
  const previewProducts = useMemo(() => products.map((product) => {
    const line = lines.find((item) => item.productId === product.id)
    const menu = menuCatalog.find((item) => item.productId === product.id)
    if (!line || !menu) return product
    const selected = new Set(line.modifierOptionIds ?? [])
    const delta = (menu.modifierGroups ?? []).flatMap((group) => group.options).filter((option) => selected.has(option.id)).reduce((sum, option) => sum + option.priceDelta, 0)
    return { ...product, sellingPrice: Math.round((product.sellingPrice + delta) * 100) / 100 }
  }), [lines, menuCatalog, products])
  const prepared = useMemo(() => {
    try {
      return { value: prepareSale(previewProducts, { items: lines, discount: effectiveDiscount, paymentMethod, notes, promotionId: promotionId || null }), error: null }
    } catch (calculationError) {
      return { value: null, error: calculationError instanceof Error ? calculationError.message : 'Check the sale details.' }
    }
  }, [effectiveDiscount, lines, notes, paymentMethod, previewProducts, promotionId])

  const addLine = () => {
    if (!selectedProductId) return
    const product = products.find((item) => item.id === selectedProductId)
    const isMenu = Boolean(product?.menuItem || product?.productClass === 'menu_item')
    if (isMenu && !menuCatalog.find((item) => item.productId === selectedProductId)?.available) return
    setLines((current) => current.some((line) => line.productId === selectedProductId) ? current : [...current, { productId: selectedProductId, quantity: 1 }])
    setSelectedProductId('')
  }
  const updateQuantity = (productId: string, quantity: number) => setLines((current) => current.map((line) => line.productId === productId ? { ...line, quantity } : line))
  const removeLine = (productId: string) => setLines((current) => current.filter((line) => line.productId !== productId))
  const updateLine = (productId: string, change: Partial<SaleRequestLine>) => setLines((current) => current.map((line) => line.productId === productId ? { ...line, ...change } : line))
  const toggleModifier = (productId: string, group: ModifierGroup, optionId: string) => setLines((current) => current.map((line) => {
    if (line.productId !== productId) return line
    const selected = new Set(line.modifierOptionIds ?? []), groupIds = new Set(group.options.map((option) => option.id))
    if (selected.has(optionId)) selected.delete(optionId)
    else {
      if (group.kind === 'single') for (const id of groupIds) selected.delete(id)
      if (group.kind === 'multi' && [...selected].filter((id) => groupIds.has(id)).length >= group.maxSelections) return line
      selected.add(optionId)
    }
    return { ...line, modifierOptionIds: [...selected] }
  }))

  const completeSale = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!repositories) return
    setSaving(true); setError(null); setSuccess(null)
    try {
      const result = await repositories.sales.record({
        items: lines,
        discount: effectiveDiscount,
        promotionId: promotionId || null,
        paymentMethod,
        notes,
        customerId: customerId || null
      })
      setSuccess(`Sale recorded successfully. Reference: ${result.saleId}`)
      setReceipt(result.receipt)
      setLines([])
      setSelectedProductId('')
      setPromotionId('')
      setDiscount(0)
      setPaymentMethod('cash')
      setNotes('')
      setCustomerId('')
      await salesPage.reload()
    } catch (saveError) {
      setError(getFirebaseErrorMessage(saveError, saveError instanceof Error ? saveError.message : 'Unable to record the sale.'))
    } finally { setSaving(false) }
  }

  if (loadingProducts || loadingCustomers || loadingPromotions || loadingMenu || salesPage.loading) return <LoadingScreen message="Loading sales…" />

  return <main className="p-4 md:p-6"><div className="mx-auto max-w-7xl">
    <PageHeader title="Sales" description="Record sales with atomic stock deduction, promotion picks, and printable receipts." />
    {(error || salesPage.error) && <ErrorMessage message={error || salesPage.error || ''} />}
    {success && <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700" role="status">{success}</div>}

    {canCreate && <form onSubmit={completeSale} className="card mb-8">
      <h2 className="mb-4 text-lg font-semibold">New sale</h2>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <select value={selectedProductId} onChange={(event) => setSelectedProductId(event.target.value)} className="min-w-0 flex-1 rounded border px-3 py-2"><option value="">Select a product</option>{activeProducts.map((product) => { const menu = menuCatalog.find((item) => item.productId === product.id), isMenu = Boolean(product.menuItem || product.productClass === 'menu_item'), unavailable = isMenu ? !menu?.available : product.trackStock && product.quantity === 0; return <option key={product.id} value={product.id} disabled={unavailable}>{product.name} — {formatZar(product.sellingPrice)}{isMenu ? ` (${menu?.available ? `${menu.maxUnits} producible${menu.low ? ', low' : ''}` : 'unavailable'})` : product.trackStock ? ` (${product.quantity} available)` : ''}</option> })}</select>
        <button type="button" onClick={addLine} className="rounded border border-primary px-4 py-2 text-primary">Add item</button>
      </div>
      {selectedProducts.length === 0 ? <EmptyState title="No sale items" description="Select a product above to begin this sale." /> : <div className="mb-5 space-y-3">{selectedProducts.map(({ line, product }) => { const menu = menuCatalog.find((item) => item.productId === product.id), preview = previewProducts.find((item) => item.id === product.id) ?? product; return <article key={product.id} className="rounded-2xl border bg-white/75 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">{product.name}</h3><p className="text-xs text-slate-500">{product.sku || 'No SKU'}{menu ? ` · max ${menu.maxUnits} · limited by ${menu.limitingIngredient?.ingredientName ?? 'recipe'}` : ''}</p></div><div className="flex items-center gap-3"><span className="font-medium">{formatZar(preview.sellingPrice * Math.max(0, line.quantity))}</span><input aria-label={`${product.name} quantity`} type="number" min="1" step="1" max={menu?.maxUnits ?? (product.trackStock ? product.quantity : undefined)} value={line.quantity} onChange={(event) => updateQuantity(product.id, Number(event.target.value))} className="w-20 rounded border px-2 py-1" /><button type="button" onClick={() => removeLine(product.id)} className="text-sm text-red-700 underline">Remove</button></div></div>{menu?.modifierGroups?.map((group) => <fieldset key={group.id} className="mt-3"><legend className="text-xs font-semibold uppercase text-slate-500">{group.name} · {group.optional ? 'optional' : 'required'} · max {group.maxSelections}</legend><div className="mt-2 flex flex-wrap gap-2">{group.options.map((option) => <label key={option.id} className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm ${(line.modifierOptionIds ?? []).includes(option.id) ? 'border-primary bg-primary/10 text-primary' : 'bg-white'}`}><input className="sr-only" type={group.kind === 'single' ? 'radio' : 'checkbox'} name={`${product.id}-${group.id}`} checked={(line.modifierOptionIds ?? []).includes(option.id)} onChange={() => toggleModifier(product.id, group, option.id)} />{option.label}{option.priceDelta ? ` ${option.priceDelta > 0 ? '+' : ''}${formatZar(option.priceDelta)}` : ''}</label>)}</div></fieldset>)}{menu && <label className="mt-3 block"><span className="text-xs font-semibold uppercase text-slate-500">Preparation notes</span><input value={line.preparationNotes ?? ''} maxLength={200} onChange={(event) => updateLine(product.id, { preparationNotes: event.target.value })} placeholder="e.g. extra crispy, cut in half" className="mt-1 w-full rounded-xl border px-3 py-2" /></label>}</article> })}</div>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {availablePromotions.length > 0 && (
          <label>
            <span className="text-sm">Promotion</span>
            <select value={promotionId} onChange={(event) => setPromotionId(event.target.value)} className="mt-1 w-full rounded border px-3 py-2">
              <option value="">No promotion</option>
              {availablePromotions.map((promotion) => <option key={promotion.id} value={promotion.id}>{promotion.name}</option>)}
            </select>
          </label>
        )}
        <label>
          <span className="text-sm">Discount (ZAR)</span>
          <input type="number" min="0" step="0.01" value={discount} onChange={(event) => setDiscount(Number(event.target.value))} disabled={!canApplyManualDiscount} className="mt-1 w-full rounded border px-3 py-2 disabled:bg-slate-100 disabled:text-slate-500" />
        </label>
        <label>
          <span className="text-sm">Payment method</span>
          <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as PaymentMethod)} className="mt-1 w-full rounded border px-3 py-2">{PAYMENT_METHODS.map((method) => <option key={method} value={method}>{method.toUpperCase()}</option>)}</select>
        </label>
        <label>
          <span className="text-sm">Customer (optional)</span>
          <select value={customerId} onChange={(event) => setCustomerId(event.target.value)} className="mt-1 w-full rounded border px-3 py-2"><option value="">Walk-in customer</option>{customers.filter((customer) => customer.status === 'active').map((customer) => <option key={customer.id} value={customer.id}>{customer.displayName}</option>)}</select>
        </label>
      </div>

      {selectedPromotion && (
        <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Active promotion: <span className="font-medium">{selectedPromotion.name}</span>
          {selectedPromotion.maxDiscountAmount != null && <span className="ml-2">(max {formatZar(selectedPromotion.maxDiscountAmount)})</span>}
        </div>
      )}

      <div className="mt-5 rounded-md bg-slate-50 p-4 text-sm">
        <div className="flex justify-between"><span>Subtotal</span><span>{formatZar(prepared.value?.subtotal ?? 0)}</span></div>
        <div className="mt-1 flex justify-between"><span>Manual discount</span><span>-{formatZar(Math.min(effectiveDiscount, prepared.value?.subtotal ?? 0))}</span></div>
        {selectedPromotion && <div className="mt-1 flex justify-between"><span>Promotion discount</span><span>-{formatZar(prepared.value?.discount ? Math.max(0, prepared.value.discount - effectiveDiscount) : 0)}</span></div>}
        <div className="mt-2 flex justify-between border-t pt-2 text-lg font-semibold"><span>Total</span><span>{formatZar(prepared.value?.total ?? 0)}</span></div>
        {lines.length > 0 && prepared.error && <p className="mt-2 text-red-700">{prepared.error}</p>}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">{canApplyManualDiscount ? 'Manual discounts are enabled for your role.' : 'Manual discount editing is restricted by role permissions.'}</p>
        <button disabled={saving || !prepared.value} className="rounded bg-primary px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-60">{saving ? 'Completing sale…' : 'Complete sale'}</button>
      </div>
    </form>}

    <section><h2 className="mb-3 text-lg font-semibold">Sales history</h2>{salesPage.items.length === 0 ? <EmptyState title="No sales recorded" description="Completed sales will appear here." /> : <><div className="overflow-x-auto rounded-lg border bg-white"><table className="w-full min-w-[980px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Date</th><th className="p-3">Reference</th><th className="p-3">Cashier</th><th className="p-3">Customer</th><th className="p-3">Items</th><th className="p-3">Payment</th><th className="p-3">Total</th>{canViewFinancials && <th className="p-3">Gross profit</th>}<th className="p-3"></th></tr></thead><tbody>{salesPage.items.map((sale) => <tr key={sale.id} className="border-t"><td className="p-3 text-slate-600">{formatDateTime(sale.createdAt)}</td><td className="p-3 font-mono text-xs">{sale.id}</td><td className="p-3"><div>{sale.cashierNameSnapshot || 'Unknown staff'}</div>{sale.cashierRoleSnapshot && <div className="text-xs capitalize text-slate-500">{sale.cashierRoleSnapshot}</div>}</td><td className="p-3">{sale.customerNameSnapshot || 'Walk-in'}</td><td className="p-3">{sale.itemCount}</td><td className="p-3 uppercase">{sale.paymentMethod}</td><td className="p-3 font-medium">{formatZar(sale.total)}</td>{canViewFinancials && <td className="p-3">{formatZar(sale.grossProfit)}</td>}<td className="p-3 text-right"><button onClick={() => setReceipt(sale)} className="text-primary underline">View receipt</button></td></tr>)}</tbody></table></div>{salesPage.hasMore && <div className="mt-4 text-center"><button onClick={() => void salesPage.loadMore()} disabled={salesPage.loadingMore} className="rounded border px-4 py-2 disabled:opacity-50">{salesPage.loadingMore ? 'Loading…' : 'Load more sales'}</button></div>}</>}</section>
  </div>{receipt && business && <SaleReceipt sale={receipt} business={business} cashierName={receipt.cashierNameSnapshot ?? null} onClose={() => setReceipt(null)} />}</main>
}
