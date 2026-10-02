import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight, Banknote, Boxes, PackageCheck, PackageX, Receipt, ShoppingCart,
  Sparkles, Tags, TrendingUp, Users, WalletCards, type LucideIcon
} from 'lucide-react'
import EmptyState from '../components/feedback/EmptyState'
import ErrorMessage from '../components/feedback/ErrorMessage'
import LoadingScreen from '../components/feedback/LoadingScreen'
import { dashboardPolicy, type DashboardMetric } from '../dashboard/dashboardPolicy'
import { useAuth } from '../hooks/useAuth'
import { createCashierDashboardService } from '../services/dashboard'
import { createOperationalReportsService } from '../services/operations'
import { createFirestoreReportsService, type DashboardAnalytics } from '../services/reports'
import { getFirebaseErrorMessage } from '../utils/firebaseErrors'
import { formatDateTime, formatZar } from '../utils/format'

type MetricCard = { id: DashboardMetric; label: string; value: string; supporting: string; icon: LucideIcon; tone: string }

const dateKey = (date: Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(date)

function greeting(date = new Date()) {
  const hour = date.getHours()
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
}

export default function Dashboard() {
  const { business, user, profile, membership, permissions } = useAuth()
  const policy = useMemo(() => dashboardPolicy(permissions), [permissions])
  const financialService = useMemo(() => business && user ? createFirestoreReportsService(business.id, user.uid) : null, [business, user])
  const operationalService = useMemo(() => createOperationalReportsService(), [])
  const cashierService = useMemo(() => business && user ? createCashierDashboardService(business.id, user.uid) : null, [business, user])
  const [stats, setStats] = useState<DashboardAnalytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!financialService || !cashierService) return
    let active = true
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    setStats(null)
    setLoading(true)
    setError(null)

    const load = policy.source === 'financial'
      ? financialService.loadDashboard(now, true)
      : policy.source === 'operational'
        ? operationalService.load(monthStart, monthEnd).then((report): DashboardAnalytics => {
          const today = report.salesTrend.find((item) => item.date === dateKey(now))
          return {
            todaysSales: today?.salesTotal ?? 0,
            monthSales: report.salesTotal,
            estimatedProfit: 0,
            expenses: 0,
            todayTransactions: today?.transactions ?? 0,
            todayUnitsSold: 0,
            lowStockCount: report.lowStock.filter((item) => item.quantity > 0).length,
            outOfStockCount: report.lowStock.filter((item) => item.quantity === 0).length,
            recentSales: report.recentSales.map((sale) => ({
              ...sale, grossProfit: 0, items: sale.items.map((item) => ({ ...item, costPrice: 0 }))
            })),
            bestSeller: report.productMovement[0]?.productName ?? null,
            totalCustomers: report.activeCustomerCount
          }
        })
        : cashierService.load(now)

    load.then((data) => { if (active) setStats(data) })
      .catch((loadError) => { if (active) setError(getFirebaseErrorMessage(loadError, 'Unable to load dashboard analytics.')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [cashierService, financialService, operationalService, policy.source])

  if (loading && !stats) return <LoadingScreen message="Preparing your dashboard..." />

  const allCards: MetricCard[] = [
    { id: 'todaySales', label: "Today's sales", value: formatZar(stats?.todaysSales ?? 0), supporting: 'Completed sales today', icon: Banknote, tone: 'bg-emerald-50 text-emerald-700' },
    { id: 'monthSales', label: 'Month sales', value: formatZar(stats?.monthSales ?? 0), supporting: 'Current reporting period', icon: TrendingUp, tone: 'bg-blue-50 text-blue-700' },
    { id: 'profit', label: 'Operating profit estimate', value: formatZar(stats?.estimatedProfit ?? 0), supporting: 'Sales margin less recorded expenses', icon: WalletCards, tone: (stats?.estimatedProfit ?? 0) < 0 ? 'bg-red-50 text-red-700' : 'bg-teal-50 text-teal-700' },
    { id: 'expenses', label: 'Expenses', value: formatZar(stats?.expenses ?? 0), supporting: 'Recorded operating spend', icon: Receipt, tone: 'bg-violet-50 text-violet-700' },
    { id: 'transactions', label: "Today's transactions", value: String(stats?.todayTransactions ?? 0), supporting: 'Completed checkouts', icon: ShoppingCart, tone: 'bg-blue-50 text-blue-700' },
    { id: 'unitsSold', label: 'Units sold today', value: String(stats?.todayUnitsSold ?? 0), supporting: 'Items across completed sales', icon: Boxes, tone: 'bg-cyan-50 text-cyan-700' },
    { id: 'lowStock', label: 'Low stock', value: String(stats?.lowStockCount ?? 0), supporting: 'Products needing attention', icon: PackageCheck, tone: 'bg-amber-50 text-amber-700' },
    { id: 'outOfStock', label: 'Out of stock', value: String(stats?.outOfStockCount ?? 0), supporting: 'Unavailable tracked products', icon: PackageX, tone: 'bg-red-50 text-red-700' },
    { id: 'customers', label: 'Active customers', value: String(stats?.totalCustomers ?? 0), supporting: 'Current customer records', icon: Users, tone: 'bg-indigo-50 text-indigo-700' }
  ]
  const cards = allCards.filter((card) => policy.metrics.includes(card.id))
  const displayName = profile?.fullName?.trim().split(/\s+/)[0] || membership?.displayName?.trim().split(/\s+/)[0] || 'there'

  return <main className="dashboard-enter p-4 md:p-6">
    <div className="mx-auto max-w-7xl">
      <header className="dashboard-rise relative overflow-hidden rounded-3xl border border-teal-900/10 bg-slate-950 px-5 py-6 text-white shadow-xl shadow-slate-900/10 md:px-7 md:py-7">
        <div className="relative z-10 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium text-teal-300">{greeting()}, {displayName}</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">Dashboard</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-300">A focused view of {business?.name ?? 'your business'} based on your current access.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 capitalize">{membership?.role}</span>
            <span className="rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1.5 text-emerald-200">{business?.accountStatus ?? 'ACTIVE'}</span>
          </div>
        </div>
        <div className="pointer-events-none absolute right-0 top-0 h-40 w-40 rounded-full bg-teal-400/10 blur-3xl" aria-hidden="true" />
      </header>

      {error && <div className="mt-5"><ErrorMessage message={error} /></div>}

      <section aria-label="Business key performance indicators" className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card, index) => {
          const Icon = card.icon
          return <article key={card.id} className="metric-card dashboard-rise min-w-0" style={{ '--enter-delay': `${45 + index * 35}ms` } as CSSProperties}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0"><p className="text-sm font-medium text-slate-500">{card.label}</p><p className="mt-2 truncate text-2xl font-semibold tracking-tight text-slate-950">{card.value}</p></div>
              <span className={`rounded-2xl p-2.5 ${card.tone}`}><Icon className="h-5 w-5" aria-hidden="true" /></span>
            </div>
            <p className="mt-4 text-xs text-slate-500">{card.supporting}</p>
          </article>
        })}
      </section>

      <section className="mt-6 grid gap-6 xl:grid-cols-[1.45fr_0.55fr]">
        <div className="section-shell dashboard-rise min-w-0" style={{ '--enter-delay': '160ms' } as CSSProperties}>
          <div className="mb-4 flex items-center justify-between gap-3">
            <div><h2 className="text-lg font-semibold">Recent sales</h2><p className="text-sm text-slate-500">Latest authorized transaction activity.</p></div>
            <Link to="/sales" className="flex shrink-0 items-center gap-1 text-sm font-medium text-primary">View sales <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
          </div>
          {!stats?.recentSales.length
            ? <EmptyState title="No recent sales" description="Completed sales will appear here as soon as checkout activity begins." action={<Link to="/sales" className="font-medium text-primary underline">Start a sale</Link>} />
            : <>
              <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[620px] text-left text-sm">
                <thead className="border-y border-slate-200 bg-slate-50/80 text-xs uppercase tracking-wide text-slate-500"><tr><th className="p-3">Date</th><th className="p-3">Customer</th><th className="p-3">Payment</th><th className="p-3">Cashier</th><th className="p-3 text-right">Total</th></tr></thead>
                <tbody>{stats.recentSales.map((sale) => <tr key={sale.id} className="border-b border-slate-100 last:border-0"><td className="p-3 text-slate-600">{formatDateTime(sale.createdAt)}</td><td className="p-3 font-medium">{sale.customerNameSnapshot || 'Walk-in'}</td><td className="p-3 uppercase text-slate-600">{sale.paymentMethod}</td><td className="p-3 text-slate-600">{sale.cashierNameSnapshot || 'Team member'}</td><td className="p-3 text-right font-semibold">{formatZar(sale.total)}</td></tr>)}</tbody>
              </table></div>
              <div className="space-y-3 md:hidden">{stats.recentSales.map((sale) => <article key={sale.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="flex items-start justify-between gap-3"><div><p className="font-medium">{sale.customerNameSnapshot || 'Walk-in customer'}</p><p className="mt-1 text-xs text-slate-500">{formatDateTime(sale.createdAt)}</p></div><p className="font-semibold">{formatZar(sale.total)}</p></div>
                <div className="mt-3 flex items-center justify-between text-xs text-slate-500"><span className="uppercase">{sale.paymentMethod}</span><span>{sale.cashierNameSnapshot || 'Team member'}</span></div>
              </article>)}</div>
            </>}
        </div>

        <aside className="space-y-4">
          <div className="section-shell dashboard-rise" style={{ '--enter-delay': '200ms' } as CSSProperties}>
            <div className="flex items-center gap-2"><span className="rounded-xl bg-amber-50 p-2 text-amber-700"><Sparkles className="h-5 w-5" aria-hidden="true" /></span><h2 className="font-semibold">Business insight</h2></div>
            {stats?.bestSeller
              ? <><p className="mt-4 text-sm text-slate-500">Best seller this month</p><p className="mt-1 text-xl font-semibold">{stats.bestSeller}</p><p className="mt-2 text-xs text-slate-500">Based on authorized sales activity.</p></>
              : <div className="mt-4"><EmptyState title="No sales insight yet" description="A best seller will appear after completed sales." /></div>}
          </div>
          <div className="section-shell dashboard-rise" style={{ '--enter-delay': '235ms' } as CSSProperties}>
            <div className="flex items-center gap-2"><span className="rounded-xl bg-teal-50 p-2 text-teal-700"><Tags className="h-5 w-5" aria-hidden="true" /></span><h2 className="font-semibold">Quick actions</h2></div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-1">{policy.actions.map((action) => <Link key={action.to} to={action.to} className="group flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 hover:border-teal-300 hover:bg-teal-50/50">
              <span><span className="block text-sm font-medium">{action.label}</span><span className="mt-0.5 block text-xs text-slate-500">{action.description}</span></span><ArrowRight className="h-4 w-4 shrink-0 text-slate-400 group-hover:text-primary" aria-hidden="true" />
            </Link>)}</div>
          </div>
        </aside>
      </section>

      <p className="mt-5 text-xs text-slate-500">{policy.source === 'financial' ? 'Profit is estimated from sale cost snapshots less recorded expenses. ' : ''}Dashboard information follows your assigned business role and current permissions.</p>
    </div>
  </main>
}
