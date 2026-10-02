import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import ErrorMessage from '../../components/feedback/ErrorMessage'
import { useAuth } from '../../hooks/useAuth'
import { getFirebaseErrorMessage } from '../../utils/firebaseErrors'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const { login } = useAuth()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await login(email.trim(), password)
      const from = (location.state as { from?: { pathname?: string; search?: string } } | null)?.from
      navigate(from?.pathname && from.pathname !== '/login' ? `${from.pathname}${from.search ?? ''}` : '/', { replace: true })
    } catch (err) {
      setError(getFirebaseErrorMessage(err, 'Unable to sign in. Check your credentials.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-md card">
        <h2 className="text-2xl font-semibold mb-4">Sign in to SmallBizz</h2>
        {error && <ErrorMessage message={error} />}
        <label className="block mb-2">
          <div className="text-sm">Email</div>
          <input type="email" className="mt-1 w-full border rounded px-3 py-2" value={email} onChange={e=>setEmail(e.target.value)} required />
        </label>
        <label className="block mb-4">
          <div className="text-sm">Password</div>
          <input type="password" className="mt-1 w-full border rounded px-3 py-2" value={password} onChange={e=>setPassword(e.target.value)} required />
        </label>
        <div className="flex items-center justify-between mb-4">
          <Link to="/forgot" className="text-sm text-primary">Forgot password?</Link>
        </div>
        <button disabled={loading} className="w-full bg-primary text-white rounded py-2">
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
        <p className="mt-4 text-center text-sm text-slate-600">
          New to SmallBizz? <Link to="/register" className="text-primary">Create an account</Link>
        </p>
      </form>
    </div>
  )
}
