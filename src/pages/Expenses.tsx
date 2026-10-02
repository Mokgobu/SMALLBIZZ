import { useEffect, useMemo, useState } from 'react'
import ConfirmationDialog from '../components/feedback/ConfirmationDialog'
import EmptyState from '../components/feedback/EmptyState'
import ErrorMessage from '../components/feedback/ErrorMessage'
import LoadingScreen from '../components/feedback/LoadingScreen'
import PageHeader from '../components/layout/PageHeader'
import { useAuth } from '../hooks/useAuth'
import { usePagedData } from '../hooks/usePagedData'
import { EXPENSE_CATEGORIES, type Expense, type ExpenseCategory, type ExpenseInput } from '../models/expense'
import { PAYMENT_METHODS, type PaymentMethod } from '../models/sale'
import type { Supplier } from '../models/supplier'
import { createFirestoreExpenseRepository } from '../services/expenses'
import { createFirestoreSupplierRepository } from '../services/suppliers'
import { getFirebaseErrorMessage } from '../utils/firebaseErrors'
import { dateInputValue, formatDateTime, formatZar } from '../utils/format'

const currentMonth = new Date().toISOString().slice(0, 7)
const emptyExpense: ExpenseInput = { description: '', category: 'other', amount: 0, expenseDate: new Date().toISOString().slice(0, 10), paymentMethod: 'cash', supplierId: null, reference: '', notes: '' }

export default function Expenses() {
  const { business, user } = useAuth()
  const repositories = useMemo(() => business && user ? { expenses: createFirestoreExpenseRepository(business.id, user.uid), suppliers: createFirestoreSupplierRepository(business.id, user.uid) } : null, [business, user])
  const expensePage = usePagedData(repositories ? repositories.expenses.listPage : null, 'Unable to load expenses.')
  const expenses = expensePage.items
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loadingSuppliers, setLoadingSuppliers] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<ExpenseCategory | 'all'>('all')
  const [month, setMonth] = useState(currentMonth)
  const [form, setForm] = useState<ExpenseInput>(emptyExpense)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [archiveTarget, setArchiveTarget] = useState<Expense | null>(null)

  useEffect(() => {
    if (!repositories) return
    setLoadingSuppliers(true)
    return repositories.suppliers.subscribe(
      (data) => { setSuppliers(data); setLoadingSuppliers(false) },
      (e) => { setError(getFirebaseErrorMessage(e, 'Unable to load suppliers.')); setLoadingSuppliers(false) }
    )
  }, [repositories])

  const filtered = expenses.filter((expense) => {
    const term = search.trim().toLowerCase()
    return expense.status === 'active' && (!term || [expense.description, expense.reference, expense.supplierNameSnapshot ?? ''].some((value) => value.toLowerCase().includes(term))) && (category === 'all' || expense.category === category) && (!month || dateInputValue(expense.expenseDate).startsWith(month))
  })
  const monthlyTotal = filtered.reduce((cents, expense) => cents + Math.round(expense.amount * 100), 0) / 100

  const openEdit = (expense: Expense) => {
    setEditing(expense); setForm({ description: expense.description, category: expense.category, amount: expense.amount, expenseDate: dateInputValue(expense.expenseDate), paymentMethod: expense.paymentMethod, supplierId: expense.supplierId, reference: expense.reference, notes: expense.notes }); setShowForm(true)
  }
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!repositories) return
    setSaving(true); setError(null)
    try { if (editing) await repositories.expenses.update(editing.id, form); else await repositories.expenses.create(form); await expensePage.reload(); setShowForm(false); setEditing(null); setForm(emptyExpense) }
    catch (e) { setError(getFirebaseErrorMessage(e, e instanceof Error ? e.message : 'Unable to save the expense.')) }
    finally { setSaving(false) }
  }
  const archive = async () => {
    if (!repositories || !archiveTarget) return
    setSaving(true)
    try { await repositories.expenses.archive(archiveTarget.id); await expensePage.reload(); setArchiveTarget(null) }
    catch (e) { setError(getFirebaseErrorMessage(e, 'Unable to archive the expense.')) }
    finally { setSaving(false) }
  }

  if (loadingSuppliers || expensePage.loading) return <LoadingScreen message="Loading expenses…" />
  return <main className="p-4 md:p-6"><div className="mx-auto max-w-7xl">
    <PageHeader title="Expenses" description="Track business spending without automatic VAT assumptions." action={<button onClick={() => { setEditing(null); setForm(emptyExpense); setShowForm(true) }} className="rounded bg-primary px-4 py-2 text-white">Add expense</button>} />
    {(error || expensePage.error) && <ErrorMessage message={error || expensePage.error || ''} />}
    {showForm && <form onSubmit={save} className="card mb-6"><h2 className="mb-4 text-lg font-semibold">{editing ? 'Edit expense' : 'Add expense'}</h2><div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <label><span className="text-sm">Description *</span><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" required /></label>
      <label><span className="text-sm">Category *</span><select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as ExpenseCategory })} className="mt-1 w-full rounded border px-3 py-2">{EXPENSE_CATEGORIES.map((value) => <option key={value} value={value}>{value.replace(/_/g, ' ')}</option>)}</select></label>
      <label><span className="text-sm">Amount (ZAR) *</span><input type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: Number(e.target.value) })} className="mt-1 w-full rounded border px-3 py-2" required /></label>
      <label><span className="text-sm">Expense date *</span><input type="date" value={form.expenseDate} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" required /></label>
      <label><span className="text-sm">Payment method *</span><select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value as PaymentMethod })} className="mt-1 w-full rounded border px-3 py-2">{PAYMENT_METHODS.map((value) => <option key={value}>{value.toUpperCase()}</option>)}</select></label>
      <label><span className="text-sm">Supplier</span><select value={form.supplierId ?? ''} onChange={(e) => setForm({ ...form, supplierId: e.target.value || null })} className="mt-1 w-full rounded border px-3 py-2"><option value="">No supplier</option>{suppliers.filter((s) => s.status === 'active').map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label><span className="text-sm">Reference</span><input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label>
      <label className="md:col-span-2"><span className="text-sm">Notes</span><input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className="mt-1 w-full rounded border px-3 py-2" /></label>
    </div><div className="mt-4 flex gap-2"><button disabled={saving} className="rounded bg-primary px-4 py-2 text-white">{saving ? 'Saving…' : 'Save expense'}</button><button type="button" onClick={() => setShowForm(false)} className="rounded border px-4 py-2">Cancel</button></div></form>}
    <div className="mb-4 grid gap-3 rounded-lg border bg-white p-4 md:grid-cols-4"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search expenses" className="rounded border px-3 py-2" /><select value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory | 'all')} className="rounded border px-3 py-2"><option value="all">All categories</option>{EXPENSE_CATEGORIES.map((value) => <option key={value}>{value.replace(/_/g, ' ')}</option>)}</select><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="rounded border px-3 py-2" /><div className="rounded bg-slate-50 px-3 py-2"><span className="text-xs text-slate-500">Filtered total</span><div className="font-semibold">{formatZar(monthlyTotal)}</div></div></div>
    {filtered.length === 0 ? <EmptyState title="No expenses found" description="Add an expense or change the current filters." /> : <div className="overflow-x-auto rounded-lg border bg-white"><table className="w-full min-w-[900px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr><th className="p-3">Date</th><th className="p-3">Description</th><th className="p-3">Category</th><th className="p-3">Supplier</th><th className="p-3">Payment</th><th className="p-3">Amount</th><th className="p-3"></th></tr></thead><tbody>{filtered.map((expense) => <tr key={expense.id} className="border-t"><td className="p-3">{formatDateTime(expense.expenseDate)}</td><td className="p-3 font-medium">{expense.description}</td><td className="p-3 capitalize">{expense.category.replace(/_/g, ' ')}</td><td className="p-3">{expense.supplierNameSnapshot || '—'}</td><td className="p-3 uppercase">{expense.paymentMethod}</td><td className="p-3 font-medium">{formatZar(expense.amount)}</td><td className="p-3 text-right"><button onClick={() => openEdit(expense)} className="mr-3 text-primary underline">Edit</button><button onClick={() => setArchiveTarget(expense)} className="text-red-700 underline">Archive</button></td></tr>)}</tbody></table></div>}
    {expensePage.hasMore && <div className="mt-4 text-center"><button onClick={() => void expensePage.loadMore()} disabled={expensePage.loadingMore} className="rounded border px-4 py-2 disabled:opacity-50">{expensePage.loadingMore ? 'Loading…' : 'Load more expenses'}</button></div>}
    <p className="mt-3 text-xs text-slate-500">Search, category, month, and totals apply to loaded expenses. Load more for older records.</p>
  </div><ConfirmationDialog open={Boolean(archiveTarget)} title="Archive expense?" message="The expense remains in Firestore but is hidden from active totals." confirmLabel="Archive" busy={saving} onConfirm={() => void archive()} onCancel={() => setArchiveTarget(null)} /></main>
}
