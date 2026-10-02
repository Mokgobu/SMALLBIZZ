import { useEffect, useMemo, useState } from 'react'
import ConfirmationDialog from '../components/feedback/ConfirmationDialog'
import EmptyState from '../components/feedback/EmptyState'
import ErrorMessage from '../components/feedback/ErrorMessage'
import LoadingScreen from '../components/feedback/LoadingScreen'
import PageHeader from '../components/layout/PageHeader'
import { aggregateCustomerSales, customerMatchesSearch } from '../domain/records'
import { useAuth } from '../hooks/useAuth'
import { usePagedData } from '../hooks/usePagedData'
import type { Customer, CustomerInput } from '../models/customer'
import type { Sale } from '../models/sale'
import { createFirestoreCustomerRepository } from '../services/customers'
import { createFirestoreSalesRepository } from '../services/sales'
import { createOperationalSalesRepository } from '../services/operations'
import { getFirebaseErrorMessage } from '../utils/firebaseErrors'
import { formatDateTime, formatZar } from '../utils/format'

const emptyCustomer: CustomerInput = { firstName: '', lastName: '', phone: '', email: '', birthday: null, notes: '' }

export default function Customers() {
  const { business, user, hasPermission } = useAuth()
  const canManage = hasPermission('manage_customers')
  const canViewFinancials = hasPermission('view_reports')
  const repositories = useMemo(() => {
    if (!business || !user) return null
    const directSales = createFirestoreSalesRepository(business.id, user.uid)
    return { customers: createFirestoreCustomerRepository(business.id, user.uid), sales: canViewFinancials ? directSales : createOperationalSalesRepository(directSales.record) }
  }, [business, user, canViewFinancials])
  const customerPage = usePagedData(repositories ? repositories.customers.listPage : null, 'Unable to load customers.')
  const customers = customerPage.items
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'active' | 'archived' | 'all'>('active')
  const [selected, setSelected] = useState<Customer | null>(null)
  const [purchases, setPurchases] = useState<Sale[]>([])
  const [loadingPurchases, setLoadingPurchases] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Customer | null>(null)
  const [form, setForm] = useState<CustomerInput>(emptyCustomer)
  const [saving, setSaving] = useState(false)
  const [archiveTarget, setArchiveTarget] = useState<Customer | null>(null)

  useEffect(() => {
    if (!repositories || !selected) { setPurchases([]); return }
    setLoadingPurchases(true)
    return repositories.sales.subscribeByCustomer(selected.id, (data) => { setPurchases(data); setLoadingPurchases(false) }, (e) => { setError(getFirebaseErrorMessage(e, 'Unable to load purchase history.')); setLoadingPurchases(false) })
  }, [repositories, selected])

  const filtered = customers.filter((customer) => customerMatchesSearch(customer, search) && (status === 'all' || customer.status === status))
  const summary = aggregateCustomerSales(purchases)
  const openEdit = (customer: Customer) => { setEditing(customer); setForm({ firstName: customer.firstName, lastName: customer.lastName, phone: customer.phone, email: customer.email, birthday: customer.birthday, notes: customer.notes }); setShowForm(true) }
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!repositories) return
    setSaving(true); setError(null)
    try { if (editing) await repositories.customers.update(editing.id, form); else await repositories.customers.create(form); await customerPage.reload(); setShowForm(false); setEditing(null); setForm(emptyCustomer) }
    catch (e) { setError(getFirebaseErrorMessage(e, e instanceof Error ? e.message : 'Unable to save the customer.')) }
    finally { setSaving(false) }
  }
  const archive = async () => {
    if (!repositories || !archiveTarget) return
    setSaving(true)
    try { await repositories.customers.archive(archiveTarget.id); await customerPage.reload(); if (selected?.id === archiveTarget.id) setSelected(null); setArchiveTarget(null) }
    catch (e) { setError(getFirebaseErrorMessage(e, 'Unable to archive the customer.')) }
    finally { setSaving(false) }
  }

  if (customerPage.loading) return <LoadingScreen message="Loading customers…" />
  return <main className="p-4 md:p-6"><div className="mx-auto max-w-7xl">
    <PageHeader title="Customers" description="Customer totals and history are derived from sales records. Search covers loaded records." action={<div className="flex gap-2">{canManage && <button onClick={() => { setEditing(null); setForm(emptyCustomer); setShowForm(true) }} className="rounded bg-primary px-4 py-2 text-white">Add customer</button>}{customerPage.hasMore && <button onClick={() => void customerPage.loadMore()} disabled={customerPage.loadingMore} className="rounded border px-4 py-2 disabled:opacity-50">{customerPage.loadingMore ? 'Loading…' : 'Load more'}</button>}</div>} />
    {(error || customerPage.error) && <ErrorMessage message={error || customerPage.error || ''} />}
    {canManage && showForm && <form onSubmit={save} className="card mb-6"><h2 className="mb-4 text-lg font-semibold">{editing ? 'Edit customer' : 'Add customer'}</h2><div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <label><span className="text-sm">First name</span><input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label><label><span className="text-sm">Last name</span><input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label><label><span className="text-sm">Phone</span><input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label><label><span className="text-sm">Email</span><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label><label><span className="text-sm">Birthday</span><input type="date" value={form.birthday ?? ''} onChange={(e) => setForm({ ...form, birthday: e.target.value || null })} className="mt-1 w-full rounded border px-3 py-2" /></label><label><span className="text-sm">Notes</span><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label>
    </div><div className="mt-4 flex gap-2"><button disabled={saving} className="rounded bg-primary px-4 py-2 text-white">{saving ? 'Saving…' : 'Save customer'}</button><button type="button" onClick={() => setShowForm(false)} className="rounded border px-4 py-2">Cancel</button></div></form>}
    <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]"><section><div className="mb-3 grid gap-3 sm:grid-cols-2"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customers" className="rounded border px-3 py-2" /><select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="rounded border px-3 py-2"><option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option></select></div>
      {filtered.length === 0 ? <EmptyState title="No customers found" description="Add a customer or change the current filters." /> : <div className="overflow-x-auto rounded-lg border bg-white"><table className="w-full min-w-[600px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Customer</th><th className="p-3">Contact</th><th className="p-3">Status</th>{canManage && <th className="p-3"></th>}</tr></thead><tbody>{filtered.map((customer) => <tr key={customer.id} className="border-t"><td className="p-3"><button onClick={() => setSelected(customer)} className="font-medium text-primary underline">{customer.displayName}</button></td><td className="p-3"><div>{customer.email || '—'}</div><div className="text-xs text-slate-500">{customer.phone}</div></td><td className="p-3 capitalize">{customer.status}</td>{canManage && <td className="p-3 text-right"><button onClick={() => openEdit(customer)} className="mr-3 text-primary underline">Edit</button>{customer.status === 'active' && <button onClick={() => setArchiveTarget(customer)} className="text-red-700 underline">Archive</button>}</td>}</tr>)}</tbody></table></div>}
    </section><aside>{selected ? <div className="card"><div className="flex justify-between gap-3"><div><h2 className="text-lg font-semibold">{selected.displayName}</h2><p className="text-sm text-slate-500">{selected.email || selected.phone || 'No contact details'}</p></div><button onClick={() => setSelected(null)} className="text-sm underline">Close</button></div><div className="mt-5 grid grid-cols-2 gap-3"><div className="rounded bg-slate-50 p-3"><p className="text-xs text-slate-500">Total spend</p><p className="font-semibold">{formatZar(summary.totalSpend)}</p></div><div className="rounded bg-slate-50 p-3"><p className="text-xs text-slate-500">Transactions</p><p className="font-semibold">{summary.transactionCount}</p></div></div><p className="mt-3 text-sm"><span className="text-slate-500">Last purchase:</span> {summary.lastPurchaseAt ? formatDateTime(summary.lastPurchaseAt) : 'None'}</p><h3 className="mb-2 mt-5 font-medium">Purchase history</h3>{loadingPurchases ? <p className="text-sm text-slate-500">Loading…</p> : purchases.length === 0 ? <p className="text-sm text-slate-500">No linked sales.</p> : <div className="space-y-2">{purchases.slice(0, 20).map((sale) => <div key={sale.id} className="flex justify-between border-t pt-2 text-sm"><span>{formatDateTime(sale.createdAt)}</span><span className="font-medium">{formatZar(sale.total)}</span></div>)}</div>}</div> : <EmptyState title="Select a customer" description="Choose a customer to view contact details and purchase history." />}</aside></div>
  </div><ConfirmationDialog open={Boolean(archiveTarget)} title="Archive customer?" message="The customer remains linked to historical sales but cannot be selected for new sales." confirmLabel="Archive" busy={saving} onConfirm={() => void archive()} onCancel={() => setArchiveTarget(null)} /></main>
}
