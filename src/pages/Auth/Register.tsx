import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import ErrorMessage from '../../components/feedback/ErrorMessage'
import { registerUser } from '../../services/auth'
import { getFirebaseErrorMessage } from '../../utils/firebaseErrors'

export default function Register() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await registerUser(fullName, email.trim(), password)
      navigate('/onboarding', { replace: true })
    } catch (err) {
      setError(getFirebaseErrorMessage(err, 'Unable to create your account. Please try again.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-md card">
        <h2 className="text-2xl font-semibold mb-4">Create your account</h2>
        {error && <ErrorMessage message={error} />}
        <label className="block mb-2">
          <div className="text-sm">Full name</div>
          <input className="mt-1 w-full border rounded px-3 py-2" value={fullName} onChange={e=>setFullName(e.target.value)} required />
        </label>
        <label className="block mb-2">
          <div className="text-sm">Email</div>
          <input type="email" className="mt-1 w-full border rounded px-3 py-2" value={email} onChange={e=>setEmail(e.target.value)} required />
        </label>
        <label className="block mb-4">
          <div className="text-sm">Password</div>
          <input type="password" minLength={6} autoComplete="new-password" className="mt-1 w-full border rounded px-3 py-2" value={password} onChange={e=>setPassword(e.target.value)} required />
        </label>
        <button disabled={loading} className="w-full bg-primary text-white rounded py-2">
          {loading ? 'Creating account...' : 'Create account'}
        </button>
        <p className="mt-4 text-center text-sm text-slate-600">
          Already registered? <Link to="/login" className="text-primary">Sign in</Link>
        </p>
      </form>
    </div>
  )
}
