import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export default function PendingStaffInvitation() {
  const { logout } = useAuth()
  const navigate = useNavigate()

  const signOut = async () => {
    await logout()
    navigate('/login', { replace: true })
  }

  return <main className="flex min-h-screen items-center justify-center p-4">
    <section className="card w-full max-w-lg">
      <p className="text-sm font-medium text-primary">SmallBizz</p>
      <h1 className="mt-2 text-2xl font-semibold">Pending staff invitation</h1>
      <p className="mt-3 text-slate-600">This account has a pending staff invitation. Open the invitation link provided by your business owner to continue.</p>
      <p className="mt-3 text-sm text-slate-500">For security, SmallBizz cannot display or recreate the invitation token here.</p>
      <button type="button" onClick={() => void signOut()} className="mt-5 text-sm font-medium text-primary underline">Sign out</button>
    </section>
  </main>
}
