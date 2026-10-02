import { useMemo, useState } from 'react'
import ConfirmationDialog from '../components/feedback/ConfirmationDialog'
import EmptyState from '../components/feedback/EmptyState'
import ErrorMessage from '../components/feedback/ErrorMessage'
import LoadingScreen from '../components/feedback/LoadingScreen'
import PageHeader from '../components/layout/PageHeader'
import { useAuth } from '../hooks/useAuth'
import { usePagedData } from '../hooks/usePagedData'
import type { Supplier, SupplierInput } from '../models/supplier'
import { createFirestoreSupplierRepository } from '../services/suppliers'
import { getFirebaseErrorMessage } from '../utils/firebaseErrors'

const emptySupplier: SupplierInput = { name: '', contactPerson: '', phone: '', email: '', address: '', notes: '' }

export default function Suppliers() {
  const { business, user } = useAuth()
  const repository = useMemo(() => business && user ? createFirestoreSupplierRepository(business.id, user.uid) : null, [business, user])
  const supplierPage = usePagedData(repository ? repository.listPage : null, 'Unable to load suppliers.')
  const suppliers = supplierPage.items
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<'active' | 'archived' | 'all'>('active')
  const [selected, setSelected] = useState<Supplier | null>(null)
  const [editing, setEditing] = useState<Supplier | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<SupplierInput>(emptySupplier)
  const [saving, setSaving] = useState(false)
  const [archiveTarget, setArchiveTarget] = useState<Supplier | null>(null)

  const filtered = suppliers.filter((supplier) => {
    const term = search.trim().toLowerCase()
    return (!term || [supplier.name, supplier.contactPerson, supplier.email, supplier.phone].some((value) => value.toLowerCase().includes(term))) && (status === 'all' || supplier.status === status)
  })
  const openEdit = (supplier: Supplier) => { setEditing(supplier); setForm({ name: supplier.name, contactPerson: supplier.contactPerson, phone: supplier.phone, email: supplier.email, address: supplier.address, notes: supplier.notes }); setShowForm(true) }
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!repository) return
    setSaving(true); setError(null)
    try { if (editing) await repository.update(editing.id, form); else await repository.create(form); await supplierPage.reload(); setShowForm(false); setEditing(null); setForm(emptySupplier) }
    catch (e) { setError(getFirebaseErrorMessage(e, e instanceof Error ? e.message : 'Unable to save the supplier.')) }
    finally { setSaving(false) }
  }
  const archive = async () => {
    if (!repository || !archiveTarget) return
    setSaving(true)
    try { await repository.archive(archiveTarget.id); await supplierPage.reload(); if (selected?.id === archiveTarget.id) setSelected(null); setArchiveTarget(null) }
    catch (e) { setError(getFirebaseErrorMessage(e, 'Unable to archive the supplier.')) }
    finally { setSaving(false) }
  }

  if (supplierPage.loading) return <LoadingScreen message="Loading suppliers…" />
  return <main className="p-4 md:p-6"><div className="mx-auto max-w-7xl">
    <PageHeader title="Suppliers" description="Maintain supplier contacts for expense attribution. Search covers loaded records." action={<div className="flex gap-2"><button onClick={() => { setEditing(null); setForm(emptySupplier); setShowForm(true) }} className="rounded bg-primary px-4 py-2 text-white">Add supplier</button>{supplierPage.hasMore && <button onClick={() => void supplierPage.loadMore()} disabled={supplierPage.loadingMore} className="rounded border px-4 py-2 disabled:opacity-50">{supplierPage.loadingMore ? 'Loading…' : 'Load more'}</button>}</div>} />
    {(error || supplierPage.error) && <ErrorMessage message={error || supplierPage.error || ''} />}
    {showForm && <form onSubmit={save} className="card mb-6"><h2 className="mb-4 text-lg font-semibold">{editing ? 'Edit supplier' : 'Add supplier'}</h2><div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3"><label><span className="text-sm">Supplier name *</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" required /></label><label><span className="text-sm">Contact person</span><input value={form.contactPerson} onChange={(e) => setForm({ ...form, contactPerson: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label><label><span className="text-sm">Phone</span><input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label><label><span className="text-sm">Email</span><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label><label><span className="text-sm">Address</span><input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label><label><span className="text-sm">Notes</span><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label></div><div className="mt-4 flex gap-2"><button disabled={saving} className="rounded bg-primary px-4 py-2 text-white">{saving ? 'Saving…' : 'Save supplier'}</button><button type="button" onClick={() => setShowForm(false)} className="rounded border px-4 py-2">Cancel</button></div></form>}
    <div className="grid gap-6 lg:grid-cols-[1.4fr_0.8fr]"><section><div className="mb-3 grid gap-3 sm:grid-cols-2"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search suppliers" className="rounded border px-3 py-2" /><select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className="rounded border px-3 py-2"><option value="active">Active</option><option value="archived">Archived</option><option value="all">All</option></select></div>{filtered.length === 0 ? <EmptyState title="No suppliers found" description="Add a supplier or change the current filters." /> : <div className="overflow-x-auto rounded-lg border bg-white"><table className="w-full min-w-[650px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Supplier</th><th className="p-3">Contact</th><th className="p-3">Status</th><th className="p-3"></th></tr></thead><tbody>{filtered.map((supplier) => <tr key={supplier.id} className="border-t"><td className="p-3"><button onClick={() => setSelected(supplier)} className="font-medium text-primary underline">{supplier.name}</button></td><td className="p-3"><div>{supplier.contactPerson || '—'}</div><div className="text-xs text-slate-500">{supplier.email || supplier.phone}</div></td><td className="p-3 capitalize">{supplier.status}</td><td className="p-3 text-right"><button onClick={() => openEdit(supplier)} className="mr-3 text-primary underline">Edit</button>{supplier.status === 'active' && <button onClick={() => setArchiveTarget(supplier)} className="text-red-700 underline">Archive</button>}</td></tr>)}</tbody></table></div>}</section><aside>{selected ? <div className="card"><div className="flex justify-between"><h2 className="text-lg font-semibold">{selected.name}</h2><button onClick={() => setSelected(null)} className="text-sm underline">Close</button></div><dl className="mt-4 space-y-3 text-sm"><div><dt className="text-slate-500">Contact person</dt><dd>{selected.contactPerson || '—'}</dd></div><div><dt className="text-slate-500">Phone</dt><dd>{selected.phone || '—'}</dd></div><div><dt className="text-slate-500">Email</dt><dd>{selected.email || '—'}</dd></div><div><dt className="text-slate-500">Address</dt><dd>{selected.address || '—'}</dd></div><div><dt className="text-slate-500">Notes</dt><dd>{selected.notes || '—'}</dd></div></dl></div> : <EmptyState title="Select a supplier" description="Choose a supplier to view its details." />}</aside></div>
  </div><ConfirmationDialog open={Boolean(archiveTarget)} title="Archive supplier?" message="Existing expenses keep their supplier snapshot, but this supplier cannot be selected for new expenses." confirmLabel="Archive" busy={saving} onConfirm={() => void archive()} onCancel={() => setArchiveTarget(null)} /></main>
}
