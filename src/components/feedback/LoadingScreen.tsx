export default function LoadingScreen({ message = 'Preparing your workspace...' }: { message?: string }) {
  return (
    <main className="app-loader relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 p-6 text-white" role="status" aria-live="polite" aria-busy="true">
      <div className="app-loader__glow app-loader__glow--top" aria-hidden="true" />
      <div className="app-loader__glow app-loader__glow--bottom" aria-hidden="true" />
      <div className="app-loader__content relative z-10 text-center">
        <div className="app-loader__mark mx-auto" aria-hidden="true"><span>SB</span></div>
        <p className="app-loader__wordmark mt-5 text-2xl font-semibold tracking-tight">SmallBizz</p>
        <div className="app-loader__indicator mx-auto mt-5 flex w-fit items-end gap-1.5" aria-hidden="true">
          <span /><span /><span />
        </div>
        <p className="app-loader__message mt-4 text-sm text-slate-300">{message}</p>
        <p className="app-loader__support mt-1 text-xs text-slate-500">Securing your business session</p>
      </div>
    </main>
  )
}
