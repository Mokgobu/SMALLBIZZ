import { useEffect, useMemo, useState } from 'react'
import ErrorMessage from '../components/feedback/ErrorMessage'
import LoadingScreen from '../components/feedback/LoadingScreen'
import PageHeader from '../components/layout/PageHeader'
import { createOperationalReportsService, type OperationalReport } from '../services/operations'
import { getFirebaseErrorMessage } from '../utils/firebaseErrors'
import { formatZar } from '../utils/format'

function dateInput(date: Date) { return date.toISOString().slice(0, 10) }

export default function OperationalReports() {
  const service = useMemo(() => createOperationalReportsService(), [])
  const [from, setFrom] = useState(() => dateInput(new Date(Date.now() - 29 * 86400000)))
  const [to, setTo] = useState(() => dateInput(new Date()))
  const [report, setReport] = useState<OperationalReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const start = new Date(`${from}T00:00:00`)
      const end = new Date(`${to}T23:59:59.999`)
      setReport(await service.load(start, end))
    } catch (reason) { setError(getFirebaseErrorMessage(reason, 'Unable to load operational reports.')) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  return <main className="p-4 md:p-6"><div className="mx-auto max-w-7xl"><PageHeader title="Operational reports" description="Sales activity, stock movement and low-stock alerts. Cost, profit, expenses and supplier data are excluded." />
    <form onSubmit={(event) => { event.preventDefault(); void load() }} className="card mb-6 flex flex-wrap items-end gap-3"><label><span className="block text-sm">From</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1 rounded border px-3 py-2" /></label><label><span className="block text-sm">To</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} className="mt-1 rounded border px-3 py-2" /></label><button className="rounded bg-primary px-4 py-2 text-white">Apply</button></form>
    {error && <ErrorMessage message={error} />}{loading ? <LoadingScreen message="Loading operational reports..." /> : report && <>
      <section className="grid gap-4 sm:grid-cols-3"><div className="card"><p className="text-sm text-slate-500">Sales total</p><p className="mt-1 text-2xl font-semibold">{formatZar(report.salesTotal)}</p></div><div className="card"><p className="text-sm text-slate-500">Transactions</p><p className="mt-1 text-2xl font-semibold">{report.transactionCount}</p></div><div className="card"><p className="text-sm text-slate-500">Units sold</p><p className="mt-1 text-2xl font-semibold">{report.unitsSold}</p></div></section>
      <div className="mt-6 grid gap-6 lg:grid-cols-2"><section className="card"><h2 className="font-semibold">Daily sales trend</h2><div className="mt-3 space-y-2">{report.salesTrend.map((day) => <div key={day.date} className="flex justify-between border-t pt-2 text-sm"><span>{day.date}</span><span>{day.transactions} sales · {formatZar(day.salesTotal)}</span></div>)}</div></section><section className="card"><h2 className="font-semibold">Product movement</h2><div className="mt-3 space-y-2">{report.productMovement.map((item) => <div key={item.productId} className="flex justify-between border-t pt-2 text-sm"><span>{item.productName}</span><span>{item.movementCount} movements · {item.netQuantityChange > 0 ? '+' : ''}{item.netQuantityChange}</span></div>)}</div></section></div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2"><section className="card"><h2 className="font-semibold">Low-stock products</h2><div className="mt-3 space-y-2">{report.lowStock.map((item) => <div key={item.id} className="flex justify-between border-t pt-2 text-sm"><span>{item.name}</span><span>{item.quantity} {item.unit}</span></div>)}</div></section><section className="card"><h2 className="font-semibold">Recent stock adjustments</h2><div className="mt-3 space-y-2">{report.recentAdjustments.map((item) => <div key={item.id} className="border-t pt-2 text-sm"><div className="flex justify-between"><span>{item.productName}</span><span>{item.quantityChange > 0 ? '+' : ''}{item.quantityChange}</span></div><p className="text-xs text-slate-500">{item.reason}</p></div>)}</div></section></div>
    </>}
  </div></main>
}
