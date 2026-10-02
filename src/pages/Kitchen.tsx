import { useEffect, useMemo, useState } from 'react'
import EmptyState from '../components/feedback/EmptyState'
import ErrorMessage from '../components/feedback/ErrorMessage'
import LoadingScreen from '../components/feedback/LoadingScreen'
import PageHeader from '../components/layout/PageHeader'
import { useAuth } from '../hooks/useAuth'
import type { KitchenOrder, KitchenStatus } from '../models/recipe'
import { createRestaurantService } from '../services/restaurant'
import { formatDateTime, formatZar } from '../utils/format'
import { getFirebaseErrorMessage } from '../utils/firebaseErrors'

const nextStatus: Partial<Record<KitchenStatus, KitchenStatus>> = { new: 'preparing', preparing: 'ready', ready: 'completed' }
const tone: Record<KitchenStatus, string> = { new: 'border-amber-300 bg-amber-50', preparing: 'border-blue-300 bg-blue-50', ready: 'border-emerald-300 bg-emerald-50', completed: 'border-slate-200 bg-white' }

export default function Kitchen() {
  const { business, hasPermission } = useAuth(), canManage = hasPermission('manage_kitchen_orders')
  const service = useMemo(() => createRestaurantService(), [])
  const [orders, setOrders] = useState<KitchenOrder[]>([]), [loading, setLoading] = useState(true), [updating, setUpdating] = useState(''), [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!business) return
    setLoading(true)
    return service.subscribeKitchenOrders(
      business.id,
      (nextOrders) => { setOrders(nextOrders); setError(null); setLoading(false) },
      (cause) => { setError(getFirebaseErrorMessage(cause, 'Unable to load kitchen orders.')); setLoading(false) }
    )
  }, [business, service])
  const advance = async (order: KitchenOrder) => { const status = nextStatus[order.status]; if (!status) return; setUpdating(order.id); try { await service.updateKitchenOrderStatus(order.id, status) } catch (cause) { setError(getFirebaseErrorMessage(cause, 'Unable to update kitchen status.')) } finally { setUpdating('') } }
  if (loading) return <LoadingScreen message="Loading kitchen…" />
  const active = orders.filter((order) => order.status !== 'completed'), completed = orders.filter((order) => order.status === 'completed').slice(0, 12)
  return <main className="p-3 md:p-6"><div className="mx-auto max-w-[1500px]"><PageHeader title="Kitchen" description="Fast, auditable preparation flow with live ticket updates." action={<span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700" role="status">Live</span>} />{error && <ErrorMessage message={error} />}
    {active.length === 0 ? <EmptyState title="Kitchen is clear" description="Prepared menu items from new sales will appear here automatically." /> : <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{active.map((order) => <article key={order.id} className={`rounded-2xl border-2 p-4 shadow-sm ${tone[order.status]}`}><div className="flex items-start justify-between"><div><p className="text-xs uppercase tracking-wide text-slate-500">Order</p><h2 className="text-2xl font-black">#{order.orderNumber}</h2></div><span className="rounded-full bg-white/80 px-3 py-1 text-xs font-bold uppercase">{order.status}</span></div><p className="mt-1 text-xs text-slate-500">{formatDateTime(order.createdAt)} · {order.cashierNameSnapshot || 'Staff'}</p><div className="mt-4 space-y-4">{order.items.map((item, index) => <div key={`${item.productId}-${index}`} className="border-t border-slate-900/10 pt-3"><p className="text-lg font-bold">{item.quantity} × {item.productName}</p>{item.modifiers.length > 0 && <ul className="mt-1 text-sm">{item.modifiers.map((modifier) => <li key={modifier.id}>+ {modifier.label}{modifier.priceDelta ? ` (${formatZar(modifier.priceDelta)})` : ''}</li>)}</ul>}{item.preparationNotes && <p className="mt-2 rounded-lg bg-white/80 p-2 text-sm font-medium">Note: {item.preparationNotes}</p>}</div>)}</div>{canManage && nextStatus[order.status] && <button disabled={updating === order.id} onClick={() => void advance(order)} className="mt-5 w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-50">{updating === order.id ? 'Updating…' : `Mark ${nextStatus[order.status]}`}</button>}</article>)}</section>}
    {completed.length > 0 && <details className="mt-8"><summary className="cursor-pointer font-semibold text-slate-600">Recently completed ({completed.length})</summary><div className="mt-3 grid gap-3 md:grid-cols-3">{completed.map((order) => <div key={order.id} className="rounded-xl border bg-white p-3 text-sm"><b>#{order.orderNumber}</b><span className="ml-2 text-slate-500">{order.items.map((item) => `${item.quantity}× ${item.productName}`).join(', ')}</span></div>)}</div></details>}
  </div></main>
}
