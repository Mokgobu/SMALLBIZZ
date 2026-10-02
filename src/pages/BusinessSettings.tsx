import { useEffect, useMemo, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import ErrorMessage from '../components/feedback/ErrorMessage'
import LoadingScreen from '../components/feedback/LoadingScreen'
import PageHeader from '../components/layout/PageHeader'
import { requireFirebase } from '../config/firebase'
import { useAuth } from '../hooks/useAuth'

type OperationsSettings = {
  defaultExpiryWarningDays: number
  defaultExpiryCriticalDays: number
  expiryAlertsEnabled: boolean
  expiryDiscountEnabled: boolean
  discountLimits: { cashier: number; supervisor: number; manager: number }
  expiryDiscountRules: Array<{ daysRemaining: number; percentage: number }>
}

export default function BusinessSettings() {
  const { hasPermission } = useAuth()
  const canManage = hasPermission('manage_business_settings')
  const { functions } = requireFirebase()
  const getSettings = useMemo(() => httpsCallable<Record<string, never>, OperationsSettings>(functions, 'getOperationsSettings'), [functions])
  const updateSettings = useMemo(() => httpsCallable<OperationsSettings, OperationsSettings>(functions, 'updateOperationsSettings'), [functions])

  const [settings, setSettings] = useState<OperationsSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    const run = async () => {
      setLoading(true)
      try {
        const response = await getSettings({})
        if (!active) return
        setSettings(response.data)
      } catch (loadError) {
        if (!active) return
        setError(loadError instanceof Error ? loadError.message : 'Unable to load settings.')
      } finally {
        if (active) setLoading(false)
      }
    }

    void run()
    return () => { active = false }
  }, [getSettings])

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!settings || !canManage) return
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const response = await updateSettings(settings)
      setSettings(response.data)
      setSuccess('Settings updated.')
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to update settings.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <LoadingScreen message="Loading settings…" />
  if (!settings) return <LoadingScreen message="Preparing settings…" />

  return (
    <main className="p-4 md:p-6">
      <div className="mx-auto max-w-6xl">
        <PageHeader title="Business settings" description="Configure expiry, discount authority, and promotion suggestion defaults." />

        {error && <ErrorMessage message={error} />}
        {success && <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{success}</div>}

        <form onSubmit={save} className="card space-y-6">
          <section>
            <h2 className="mb-3 text-lg font-semibold">Expiry</h2>
            <div className="grid gap-4 md:grid-cols-2">
              <label><span className="text-sm">Default warning days</span><input type="number" min="0" step="1" value={settings.defaultExpiryWarningDays} onChange={(event) => setSettings((prev) => prev ? { ...prev, defaultExpiryWarningDays: Number(event.target.value) } : prev)} className="mt-1 w-full rounded border px-3 py-2" /></label>
              <label><span className="text-sm">Default critical days</span><input type="number" min="0" step="1" value={settings.defaultExpiryCriticalDays} onChange={(event) => setSettings((prev) => prev ? { ...prev, defaultExpiryCriticalDays: Number(event.target.value) } : prev)} className="mt-1 w-full rounded border px-3 py-2" /></label>
            </div>
            <div className="mt-4 flex flex-wrap gap-4">
              <label className="flex items-center gap-2"><input type="checkbox" checked={settings.expiryAlertsEnabled} onChange={(event) => setSettings((prev) => prev ? { ...prev, expiryAlertsEnabled: event.target.checked } : prev)} /> Expiry alerts enabled</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={settings.expiryDiscountEnabled} onChange={(event) => setSettings((prev) => prev ? { ...prev, expiryDiscountEnabled: event.target.checked } : prev)} /> Expiry discount suggestions enabled</label>
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold">Discount authority</h2>
            <div className="grid gap-4 md:grid-cols-3">
              <label><span className="text-sm">Cashier max discount (%)</span><input type="number" min="0" max="100" step="1" value={settings.discountLimits.cashier} onChange={(event) => setSettings((prev) => prev ? { ...prev, discountLimits: { ...prev.discountLimits, cashier: Number(event.target.value) } } : prev)} className="mt-1 w-full rounded border px-3 py-2" /></label>
              <label><span className="text-sm">Supervisor max discount (%)</span><input type="number" min="0" max="100" step="1" value={settings.discountLimits.supervisor} onChange={(event) => setSettings((prev) => prev ? { ...prev, discountLimits: { ...prev.discountLimits, supervisor: Number(event.target.value) } } : prev)} className="mt-1 w-full rounded border px-3 py-2" /></label>
              <label><span className="text-sm">Manager max discount (%)</span><input type="number" min="0" max="100" step="1" value={settings.discountLimits.manager} onChange={(event) => setSettings((prev) => prev ? { ...prev, discountLimits: { ...prev.discountLimits, manager: Number(event.target.value) } } : prev)} className="mt-1 w-full rounded border px-3 py-2" /></label>
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold">Expiry discount rules</h2>
            <div className="space-y-3">
              {settings.expiryDiscountRules.map((rule, index) => (
                <div key={`${rule.daysRemaining}-${index}`} className="grid gap-3 md:grid-cols-2">
                  <label><span className="text-sm">Days remaining</span><input type="number" min="0" step="1" value={rule.daysRemaining} onChange={(event) => setSettings((prev) => prev ? { ...prev, expiryDiscountRules: prev.expiryDiscountRules.map((item, itemIndex) => itemIndex === index ? { ...item, daysRemaining: Number(event.target.value) } : item) } : prev)} className="mt-1 w-full rounded border px-3 py-2" /></label>
                  <label><span className="text-sm">Suggested percentage</span><input type="number" min="0" max="100" step="1" value={rule.percentage} onChange={(event) => setSettings((prev) => prev ? { ...prev, expiryDiscountRules: prev.expiryDiscountRules.map((item, itemIndex) => itemIndex === index ? { ...item, percentage: Number(event.target.value) } : item) } : prev)} className="mt-1 w-full rounded border px-3 py-2" /></label>
                </div>
              ))}
            </div>
          </section>

          <div className="flex justify-end">
            <button type="submit" disabled={!canManage || saving} className="rounded bg-primary px-4 py-2 text-white disabled:opacity-60">
              {saving ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        </form>
      </div>
    </main>
  )
}
