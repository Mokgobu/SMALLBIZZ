import { useAuth } from '../../hooks/useAuth'

export default function AccountUnavailable({ message }: { message: string }) {
  const { logout } = useAuth()

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <section className="card w-full max-w-lg text-center">
        <h1 className="mb-2 text-2xl font-semibold">Account unavailable</h1>
        <p className="mb-6 text-slate-600">{message}</p>
        <div className="flex flex-wrap justify-center gap-3">
          <button type="button" className="rounded border border-slate-300 bg-white px-4 py-2" onClick={() => window.location.reload()}>Retry</button>
          <button type="button" className="rounded bg-primary px-4 py-2 text-white" onClick={() => void logout()}>Sign out</button>
        </div>
      </section>
    </main>
  )
}
