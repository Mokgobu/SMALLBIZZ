import { useEffect, useMemo, useState } from 'react'
import EmptyState from '../components/feedback/EmptyState'
import ErrorMessage from '../components/feedback/ErrorMessage'
import LoadingScreen from '../components/feedback/LoadingScreen'
import PageHeader from '../components/layout/PageHeader'
import { expensesCsv, productsCsv, salesCsv } from '../domain/csv'
import { resolveReportDateRange, type ReportDatePreset } from '../domain/reports'
import { useAuth } from '../hooks/useAuth'
import { createFirestoreReportsService, type LoadedReport } from '../services/reports'
import { downloadTextFile } from '../utils/download'
import { getFirebaseErrorMessage } from '../utils/firebaseErrors'
import { formatZar } from '../utils/format'

const presets: Array<{ value: ReportDatePreset; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'last_7_days', label: 'Last 7 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'custom', label: 'Custom range' }
]

function inputDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function Metric({ label, value, estimate = false }: { label: string; value: string; estimate?: boolean }) {
  return <div className="card"><p className="text-sm text-slate-500">{label}{estimate ? ' (estimate)' : ''}</p><p className="mt-1 text-2xl font-semibold">{value}</p></div>
}

export default function Reports() {
  const { business, user } = useAuth()
  const service = useMemo(() => business && user ? createFirestoreReportsService(business.id, user.uid) : null, [business, user])
  const today = useMemo(() => new Date(), [])
  const [preset, setPreset] = useState<ReportDatePreset>('this_month')
  const [from, setFrom] = useState(inputDate(new Date(today.getFullYear(), today.getMonth(), 1)))
  const [to, setTo] = useState(inputDate(today))
  const [report, setReport] = useState<LoadedReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!service) return
    let active = true
    const load = async () => {
      setLoading(true)
      setError(null)
      try {
        const range = resolveReportDateRange(preset, new Date(), { from, to })
        const result = await service.load(range)
        if (active) setReport(result)
      } catch (loadError) {
        if (active) setError(getFirebaseErrorMessage(loadError, loadError instanceof Error ? loadError.message : 'Unable to load reports.'))
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [from, preset, service, to])

  const exportFile = (kind: 'sales' | 'expenses' | 'products') => {
    if (!report) return
    const suffix = `${inputDate(report.range.start)}-${inputDate(new Date(report.range.end.getTime() - 1))}`
    if (kind === 'sales') downloadTextFile(salesCsv(report.source.sales), `smallbizz-sales-${suffix}.csv`)
    if (kind === 'expenses') downloadTextFile(expensesCsv(report.source.expenses), `smallbizz-expenses-${suffix}.csv`)
    if (kind === 'products') downloadTextFile(productsCsv(report.source.products), `smallbizz-products-${inputDate(new Date())}.csv`)
  }

  if (loading && !report) return <LoadingScreen message="Preparing reports…" />
  const summary = report?.summary

  return <main className="p-4 md:p-6"><div className="mx-auto max-w-7xl">
    <PageHeader title="Reports" description="Tenant-scoped sales, expense, customer, and inventory insights." />
    {error && <ErrorMessage message={error} />}

    <section className="mb-6 rounded-lg border bg-white p-4">
      <div className="grid gap-3 md:grid-cols-5">
        <label className="md:col-span-2"><span className="text-sm">Date range</span><select value={preset} onChange={(event) => setPreset(event.target.value as ReportDatePreset)} className="mt-1 w-full rounded border px-3 py-2">{presets.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        {preset === 'custom' && <><label><span className="text-sm">From</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1 w-full rounded border px-3 py-2" /></label><label><span className="text-sm">To</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="mt-1 w-full rounded border px-3 py-2" /></label></>}
        <div className="flex flex-wrap items-end gap-2 md:col-start-5">
          <button onClick={() => exportFile('sales')} disabled={!report} className="rounded border border-primary px-3 py-2 text-sm text-primary disabled:opacity-50">Sales CSV</button>
          <button onClick={() => exportFile('expenses')} disabled={!report} className="rounded border border-primary px-3 py-2 text-sm text-primary disabled:opacity-50">Expenses CSV</button>
          <button onClick={() => exportFile('products')} disabled={!report} className="rounded border border-primary px-3 py-2 text-sm text-primary disabled:opacity-50">Products CSV</button>
        </div>
      </div>
      <p className="mt-3 text-xs text-slate-500">{loading ? 'Refreshing…' : report?.range.label}. Search-style exports contain only this business’s loaded report data.</p>
    </section>

    {summary && <>
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Gross sales" value={formatZar(summary.grossSales)} />
        <Metric label="Discounts" value={formatZar(summary.discounts)} />
        <Metric label="Net sales" value={formatZar(summary.netSales)} />
        <Metric label="Cost of goods sold" value={formatZar(summary.estimatedCogs)} estimate />
        <Metric label="Gross profit" value={formatZar(summary.estimatedGrossProfit)} estimate />
        <Metric label="Expenses" value={formatZar(summary.expenses)} />
        <Metric label="Operating profit" value={formatZar(summary.estimatedOperatingProfit)} estimate />
        <Metric label="Average sale" value={formatZar(summary.averageSaleValue)} />
      </section>

      <section className="my-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ['Transactions', summary.transactionCount], ['Units sold', summary.unitsSold],
          ['Low stock', summary.lowStockProducts.length], ['Out of stock', summary.outOfStockProducts.length],
          ['Active customers', summary.activeCustomerCount], ['Stock movements', summary.inventoryMovementCount]
        ].map(([label, value]) => <div key={label} className="rounded-lg border bg-white p-3"><p className="text-xs text-slate-500">{label}</p><p className="text-xl font-semibold">{value}</p></div>)}
      </section>

      <section className="mb-6 rounded-2xl border bg-white/80 p-4 shadow-sm"><div className="mb-4"><h2 className="text-lg font-semibold">Restaurant operations</h2><p className="text-sm text-slate-500">Based on immutable menu sale and recipe-consumption snapshots.</p></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Metric label="Menu units" value={String(summary.restaurant.menuUnitsSold)} /><Metric label="Menu revenue" value={formatZar(summary.restaurant.menuRevenue)} /><Metric label="Recipe cost" value={formatZar(summary.restaurant.estimatedRecipeCost)} estimate /><Metric label="Food margin" value={formatZar(summary.restaurant.estimatedFoodMargin)} estimate /><Metric label="Waste quantity" value={String(summary.restaurant.wasteQuantity)} /></div><div className="mt-5 grid gap-5 md:grid-cols-2"><div><h3 className="font-medium">Top menu items</h3>{summary.restaurant.topMenuItems.map((item) => <div key={item.productId} className="mt-2 flex justify-between border-t pt-2 text-sm"><span>{item.productName}</span><span>{item.unitsSold} · {formatZar(item.revenue)}</span></div>)}</div><div><h3 className="font-medium">Ingredient usage</h3>{summary.restaurant.ingredientUsage.map((item) => <div key={item.productId} className="mt-2 flex justify-between border-t pt-2 text-sm"><span>{item.productName}</span><span>{item.quantity} {item.unit}</span></div>)}</div></div></section>

      {summary.transactionCount === 0 && summary.expenses === 0 && <div className="mb-6"><EmptyState title="No activity in this period" description="Choose another date range or record sales and expenses first." /></div>}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card"><h2 className="mb-3 text-lg font-semibold">Best-selling products</h2>{summary.bestSellingProducts.length === 0 ? <p className="text-sm text-slate-500">No product sales in this period.</p> : <div className="space-y-2">{summary.bestSellingProducts.map((product) => <div key={product.productId || product.productName} className="flex justify-between gap-4 border-t pt-2 text-sm"><span>{product.productName}</span><span className="font-medium">{product.unitsSold} units</span></div>)}</div>}</section>
        <section className="card"><h2 className="mb-3 text-lg font-semibold">Highest-revenue products</h2>{summary.highestRevenueProducts.length === 0 ? <p className="text-sm text-slate-500">No product revenue in this period.</p> : <div className="space-y-2">{summary.highestRevenueProducts.map((product) => <div key={product.productId || product.productName} className="flex justify-between gap-4 border-t pt-2 text-sm"><span>{product.productName}</span><span className="font-medium">{formatZar(product.revenue)}</span></div>)}</div>}</section>
        <section className="card"><h2 className="mb-3 text-lg font-semibold">Top customers by spend</h2>{summary.topCustomers.length === 0 ? <p className="text-sm text-slate-500">No customer-linked sales in this period.</p> : <div className="space-y-2">{summary.topCustomers.map((customer) => <div key={customer.customerId} className="flex justify-between gap-4 border-t pt-2 text-sm"><span>{customer.customerName}<span className="ml-2 text-xs text-slate-500">{customer.transactionCount} transactions</span></span><span className="font-medium">{formatZar(customer.totalSpend)}</span></div>)}</div>}</section>
        <section className="card"><h2 className="mb-3 text-lg font-semibold">Payment methods</h2>{summary.payments.length === 0 ? <p className="text-sm text-slate-500">No payments in this period.</p> : <div className="space-y-2">{summary.payments.map((payment) => <div key={payment.paymentMethod} className="flex justify-between gap-4 border-t pt-2 text-sm"><span className="uppercase">{payment.paymentMethod}<span className="ml-2 text-xs text-slate-500">{payment.transactionCount} transactions</span></span><span className="font-medium">{formatZar(payment.netSales)}</span></div>)}</div>}</section>
        <section className="card"><h2 className="mb-3 text-lg font-semibold">Expenses by category</h2>{summary.expensesByCategory.length === 0 ? <p className="text-sm text-slate-500">No active expenses in this period.</p> : <div className="space-y-2">{summary.expensesByCategory.map((category) => <div key={category.category} className="flex justify-between gap-4 border-t pt-2 text-sm"><span className="capitalize">{category.category.replace(/_/g, ' ')}</span><span className="font-medium">{formatZar(category.amount)}</span></div>)}</div>}</section>
        <section className="card"><h2 className="mb-3 text-lg font-semibold">Stock attention</h2>{summary.lowStockProducts.length + summary.outOfStockProducts.length === 0 ? <p className="text-sm text-slate-500">No tracked products currently need attention.</p> : <div className="space-y-2">{[...summary.outOfStockProducts, ...summary.lowStockProducts].slice(0, 10).map((product) => <div key={product.id} className="flex justify-between gap-4 border-t pt-2 text-sm"><span>{product.name}</span><span className={product.quantity === 0 ? 'font-medium text-red-700' : 'font-medium text-amber-700'}>{product.quantity === 0 ? 'Out of stock' : `${product.quantity} remaining`}</span></div>)}</div>}</section>
      </div>
      <p className="mt-6 text-xs text-slate-500">Profit and COGS figures are estimates based on immutable sale-item cost snapshots. They do not include tax adjustments, depreciation, or unrecorded costs.</p>
    </>}
  </div></main>
}
