export default function ConfirmationDialog({ open, title, message, confirmLabel, busy, onConfirm, onCancel }: {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true" aria-labelledby="confirmation-title">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <h2 id="confirmation-title" className="text-lg font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-slate-600">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button disabled={busy} onClick={onCancel} className="rounded border px-4 py-2">Cancel</button>
          <button disabled={busy} onClick={onConfirm} className="rounded bg-red-700 px-4 py-2 text-white disabled:opacity-60">{busy ? 'Working…' : confirmLabel}</button>
        </div>
      </div>
    </div>
  )
}
