import { useCallback, useEffect, useMemo, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import EmptyState from '../components/feedback/EmptyState'
import ErrorMessage from '../components/feedback/ErrorMessage'
import LoadingScreen from '../components/feedback/LoadingScreen'
import PageHeader from '../components/layout/PageHeader'
import { requireFirebase } from '../config/firebase'
import { useAuth } from '../hooks/useAuth'

type ExpiryBatch = {
  id: string
  batchId: string
  productId: string
  productNameSnapshot: string
  categorySnapshot: string
  quantityReceived: number
  quantityRemaining: number
  expiryDate: string | null
  supplierNameSnapshot: string | null
  reference: string
  status: string
  expiryState: string
  daysRemaining: number
  suggestedDiscount: number | null
  estimatedValueAtRisk?: number
  costPriceSnapshot?: number
}

type ExpirySummary = {
  enabled: boolean
  unitsAtRisk: number
  expiresTodayUnits: number
  expiredBatches: number
  estimatedValueAtRisk?: number
}

const PAGE_SIZE = 40

export default function Expiry() {
  const { hasPermission } = useAuth()
  const canManage = hasPermission('manage_expiry')
  const [summary, setSummary] = useState<ExpirySummary | null>(null)
  const [items, setItems] = useState<ExpiryBatch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [cursor, setCursor] = useState<{ expiryDate: string; id: string } | null>(null)

  const { functions } = requireFirebase()
  const listExpiryBatches = useMemo(
    () => httpsCallable<{ cursorExpiryDate?: string | null; cursorId?: string | null; pageSize?: number }, { items: ExpiryBatch[]; cursor: { expiryDate: string; id: string } | null; hasMore: boolean }>(functions, 'listExpiryBatches'),
    [functions]
  )
  const getExpirySummaryCall = useMemo(
    () => httpsCallable<Record<string, never>, ExpirySummary>(functions, 'getExpirySummary'),
    [functions]
  )

  const loadSummary = useCallback(async () => {
    try {
      const response = await getExpirySummaryCall({})
      setSummary(response.data)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load expiry summary.')
    }
  }, [getExpirySummaryCall])

  const loadPage = useCallback(async (nextCursor?: { expiryDate: string; id: string } | null) => {
    const response = await listExpiryBatches({
      cursorExpiryDate: nextCursor?.expiryDate ?? null,
      cursorId: nextCursor?.id ?? null,
      pageSize: PAGE_SIZE
    })
    const page = response.data
    return {
      items: page.items ?? [],
      cursor: page.cursor ?? null,
      hasMore: Boolean(page.hasMore)
    }
  }, [listExpiryBatches])

  useEffect(() => {
    let active = true

    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        const page = await loadPage()
        if (!active) return
        setItems(page.items)
        setCursor(page.cursor)
        setHasMore(page.hasMore)
      } catch (loadError) {
        if (!active) return
        setError(loadError instanceof Error ? loadError.message : 'Unable to load batches.')
      } finally {
        if (active) setLoading(false)
      }
    }

    void run()
    void loadSummary()

    return () => {
      active = false
    }
  }, [loadPage, loadSummary])

  const loadMore = async () => {
    if (!cursor) return
    try {
      const page = await loadPage(cursor)
      setItems((current) => [...current, ...page.items])
      setCursor(page.cursor)
      setHasMore(page.hasMore)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load more batches.')
    }
  }

  if (loading) return <LoadingScreen message="Loading expiry batches…" />

  return (
    <main className="p-4 md:p-6">
      <div className="mx-auto max-w-7xl">
        <PageHeader
          title="Expiry"
          description="Monitor batch expiry status, stock at risk, and upcoming retail action."
          action={canManage ? <button className="rounded bg-primary px-4 py-2 text-white">Review batches</button> : undefined}
        />

        {error && <ErrorMessage message={error} />}

        <section className="mb-8 grid gap-4 md:grid-cols-4">
          <div className="card">
            <p className="text-sm text-slate-500">Units at risk</p>
            <p className="mt-2 text-2xl font-semibold">{summary?.unitsAtRisk ?? 0}</p>
          </div>
          <div className="card">
            <p className="text-sm text-slate-500">Expires today</p>
            <p className="mt-2 text-2xl font-semibold">{summary?.expiresTodayUnits ?? 0}</p>
          </div>
          <div className="card">
            <p className="text-sm text-slate-500">Expired batches</p>
            <p className="mt-2 text-2xl font-semibold text-red-700">{summary?.expiredBatches ?? 0}</p>
          </div>
          <div className="card">
            <p className="text-sm text-slate-500">Estimated value at risk</p>
            <p className="mt-2 text-2xl font-semibold">{summary?.estimatedValueAtRisk ?? 0}</p>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Batches</h2>

          {items.length === 0 ? (
            <EmptyState
              title="No expiry batches"
              description="Stock receiving will create batches that appear here in FEFO order."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-white">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="p-3">Product</th>
                    <th className="p-3">Batch</th>
                    <th className="p-3">Expiry</th>
                    <th className="p-3">State</th>
                    <th className="p-3">Remaining</th>
                    <th className="p-3">Suggested discount</th>
                    <th className="p-3">Supplier</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((batch) => (
                    <tr key={batch.id} className="border-t">
                      <td className="p-3">
                        <div className="font-medium">{batch.productNameSnapshot}</div>
                        <div className="text-xs text-slate-500">{batch.categorySnapshot || 'Uncategorized'}</div>
                      </td>
                      <td className="p-3 font-mono text-xs">{batch.batchId}</td>
                      <td className="p-3">{batch.expiryDate || 'No expiry date'}</td>
                      <td className="p-3">
                        <span className={`rounded-full px-2 py-1 text-xs font-medium ${batch.expiryState === 'expired' ? 'bg-red-100 text-red-700' : batch.expiryState === 'critical' || batch.expiryState === 'expires_today' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
                          {batch.expiryState}
                        </span>
                      </td>
                      <td className="p-3">{batch.quantityRemaining}</td>
                      <td className="p-3">{batch.suggestedDiscount ?? '—'}</td>
                      <td className="p-3">{batch.supplierNameSnapshot || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {hasMore && (
            <div className="mt-4 text-center">
              <button onClick={() => void loadMore()} className="rounded border px-4 py-2">
                Load more batches
              </button>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
