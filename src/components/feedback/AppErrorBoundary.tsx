import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { failed: boolean }

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('SmallBizz application error', error, info)
  }

  render() {
    if (!this.state.failed) return this.props.children

    return (
      <main className="min-h-screen grid place-items-center p-6">
        <section className="card w-full max-w-lg text-center" role="alert">
          <p className="text-sm font-semibold text-primary">SmallBizz</p>
          <h1 className="mt-2 text-2xl font-bold">We could not open this page</h1>
          <p className="mt-2 text-slate-600">Your information is safe. Reload SmallBizz to try again.</p>
          <button type="button" className="mt-6 rounded-xl bg-primary px-5 py-2.5 font-semibold text-white" onClick={() => window.location.reload()}>
            Reload SmallBizz
          </button>
        </section>
      </main>
    )
  }
}
