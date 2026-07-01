import { Component, type ErrorInfo, type ReactNode } from 'react'
import { STORE_KEY, exportData } from '../storage'
import { download } from '../util'

// Last line of defence: if any render throws (e.g. a corrupt rehydrated state slips through),
// show a recovery screen instead of a blank white window. Uses plain DOM actions only — no hooks,
// no store, no ConfirmProvider — because the thing that crashed might be any of those.
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Aphelion crashed:', error, info)
  }

  private reset = () => {
    if (window.confirm('Reset all local data? Your characters, chats, and settings will be cleared. This cannot be undone — export a backup first.')) {
      try {
        localStorage.removeItem(STORE_KEY)
      } catch {
        /* ignore */
      }
      window.location.reload()
    }
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="crash-screen" role="alert">
        <div className="crash-box">
          <h2>Something went wrong</h2>
          <p>Aphelion hit an unexpected error. Your saved data is untouched — export a backup before resetting.</p>
          <pre className="crash-detail">{String(this.state.error?.message || this.state.error)}</pre>
          <div className="crash-actions">
            <button className="btn" onClick={() => window.location.reload()}>
              Reload
            </button>
            <button
              className="btn ghost"
              onClick={() => download('aphelion-backup.json', exportData(), 'application/json')}
            >
              Export data
            </button>
            <button className="btn ghost danger" onClick={this.reset}>
              Reset
            </button>
          </div>
        </div>
      </div>
    )
  }
}
