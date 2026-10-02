import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ErrorMessage from '../../components/feedback/ErrorMessage'
import { useAuth } from '../../hooks/useAuth'
import type { OnboardingDetails } from '../../models/business'
import { completeBusinessOnboarding, CURRENT_TERMS_VERSION } from '../../services/onboarding'
import { getFirebaseErrorMessage } from '../../utils/firebaseErrors'

const BUSINESS_TYPES = [
  'Retail',
  'Clothing',
  'Food and beverage',
  'Professional services',
  'Construction',
  'Health and beauty',
  'Technology',
  'Other'
]

const initialForm: OnboardingDetails = {
  businessName: '',
  businessType: '',
  phone: '',
  email: '',
  address: '',
  website: '',
  registrationNumber: '',
  vatRegistered: false,
  vatNumber: '',
  currency: 'ZAR',
  invoicePrefix: '',
  acceptedTerms: false
}

export default function Onboarding() {
  const { user, profile, logout } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState<OnboardingDetails>({
    ...initialForm,
    email: user?.email ?? profile?.email ?? ''
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const updateForm = <K extends keyof OnboardingDetails>(key: K, value: OnboardingDetails[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)

    if (!user) {
      setError('Your session has expired. Sign in and try again.')
      return
    }

    if (!form.businessType) {
      setError('Choose the business type that best matches your business.')
      return
    }

    if (!form.acceptedTerms) {
      setError('You must accept the Terms & Conditions before continuing.')
      return
    }

    setLoading(true)
    try {
      await completeBusinessOnboarding(user.uid, user.email, user.displayName, Boolean(profile), form)
      navigate('/', { replace: true })
    } catch (saveError) {
      setError(getFirebaseErrorMessage(saveError, saveError instanceof Error ? saveError.message : 'Unable to save your business details.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="card w-full max-w-2xl">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold">Business onboarding</h1>
            <p className="mt-1 text-sm text-slate-600">Tell us about your business to finish setting up your account.</p>
          </div>
          <button type="button" onClick={() => void logout()} className="text-sm text-slate-600 underline">Sign out</button>
        </div>

        {error && <ErrorMessage message={error} />}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <label>
            <span className="text-sm">Business name</span>
            <input value={form.businessName} onChange={(event) => updateForm('businessName', event.target.value)} className="mt-1 w-full rounded border px-3 py-2" required />
          </label>
          <label>
            <span className="text-sm">Business type</span>
            <select value={form.businessType} onChange={(event) => updateForm('businessType', event.target.value)} className="mt-1 w-full rounded border px-3 py-2" required>
              <option value="" disabled>Select a business type</option>
              {BUSINESS_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          <label>
            <span className="text-sm">Phone</span>
            <input type="tel" value={form.phone} onChange={(event) => updateForm('phone', event.target.value)} className="mt-1 w-full rounded border px-3 py-2" />
          </label>
          <label>
            <span className="text-sm">Business email</span>
            <input type="email" value={form.email} onChange={(event) => updateForm('email', event.target.value)} className="mt-1 w-full rounded border px-3 py-2" />
          </label>
          <label className="md:col-span-2">
            <span className="text-sm">Address</span>
            <input value={form.address} onChange={(event) => updateForm('address', event.target.value)} className="mt-1 w-full rounded border px-3 py-2" />
          </label>
          <label>
            <span className="text-sm">Website</span>
            <input type="url" value={form.website} onChange={(event) => updateForm('website', event.target.value)} className="mt-1 w-full rounded border px-3 py-2" placeholder="https://" />
          </label>
          <label>
            <span className="text-sm">Business registration number</span>
            <input value={form.registrationNumber} onChange={(event) => updateForm('registrationNumber', event.target.value)} className="mt-1 w-full rounded border px-3 py-2" />
          </label>
          <label>
            <span className="text-sm">VAT registered?</span>
            <select value={form.vatRegistered ? 'yes' : 'no'} onChange={(event) => updateForm('vatRegistered', event.target.value === 'yes')} className="mt-1 w-full rounded border px-3 py-2">
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </label>
          {form.vatRegistered && (
            <label>
              <span className="text-sm">VAT number</span>
              <input value={form.vatNumber} onChange={(event) => updateForm('vatNumber', event.target.value)} className="mt-1 w-full rounded border px-3 py-2" required />
            </label>
          )}
          <label>
            <span className="text-sm">Currency</span>
            <select value={form.currency} onChange={(event) => updateForm('currency', event.target.value)} className="mt-1 w-full rounded border px-3 py-2">
              <option value="ZAR">ZAR — South African rand</option>
            </select>
          </label>
          <label>
            <span className="text-sm">Invoice prefix</span>
            <input value={form.invoicePrefix} onChange={(event) => updateForm('invoicePrefix', event.target.value)} className="mt-1 w-full rounded border px-3 py-2" placeholder="INV" />
          </label>
        </div>

        <label className="mt-6 flex items-start gap-3 rounded-md border bg-slate-50 p-3">
          <input type="checkbox" checked={form.acceptedTerms} onChange={(event) => updateForm('acceptedTerms', event.target.checked)} className="mt-1" required />
          <span className="text-sm text-slate-700">
            I accept the SmallBizz Terms &amp; Conditions (version {CURRENT_TERMS_VERSION}).
          </span>
        </label>

        <button disabled={loading} className="mt-6 rounded bg-primary px-4 py-2 text-white disabled:cursor-not-allowed disabled:opacity-60">
          {loading ? 'Saving…' : 'Save and continue'}
        </button>
      </form>
    </main>
  )
}
