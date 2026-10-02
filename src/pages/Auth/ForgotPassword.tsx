import { useState } from 'react'
import { Link } from 'react-router-dom'
import ErrorMessage from '../../components/feedback/ErrorMessage'
import { useAuth } from '../../hooks/useAuth'
import { getFirebaseErrorMessage } from '../../utils/firebaseErrors'

export default function ForgotPassword(){
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { sendPasswordReset } = useAuth()

  const handleSubmit = async (e: React.FormEvent) =>{
    e.preventDefault()
    setLoading(true)
    setMessage(null)
    setError(null)
    try{
      await sendPasswordReset(email.trim())
      setMessage('Password reset email sent. Check your inbox.')
    }catch(err){
      setError(getFirebaseErrorMessage(err, 'Unable to send the reset email. Please try again.'))
    }finally{
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="w-full max-w-md card">
        <h2 className="text-2xl font-semibold mb-4">Reset your password</h2>
        {error && <ErrorMessage message={error} />}
        {message && <div className="mb-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700" role="status">{message}</div>}
        <label className="block mb-4">
          <div className="text-sm">Email</div>
          <input type="email" className="mt-1 w-full border rounded px-3 py-2" value={email} onChange={e=>setEmail(e.target.value)} required />
        </label>
        <button disabled={loading} className="w-full bg-primary text-white rounded py-2">{loading ? 'Sending...' : 'Send reset email'}</button>
        <p className="mt-4 text-center text-sm"><Link to="/login" className="text-primary">Back to sign in</Link></p>
      </form>
    </div>
  )
}
