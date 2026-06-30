import { getCurrentWindow } from '@tauri-apps/api/window'
import { CoronaMark } from './CoronaMark'

// Custom frameless title bar (the window uses decorations:false). The bar is a Tauri drag region;
// the controls call the window API directly. getCurrentWindow() is resolved lazily in the handlers
// so a non-Tauri context (browser dev) doesn't fault at import time.
export function TitleBar() {
  const win = () => getCurrentWindow()
  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="titlebar-brand" data-tauri-drag-region>
        <CoronaMark size={15} />
        <span>Aphelion</span>
      </div>
      <div className="titlebar-controls">
        <button className="tb-btn" aria-label="Minimize" title="Minimize" onClick={() => win().minimize()}>
          <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
            <line x1="2" y1="5.5" x2="9" y2="5.5" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
        <button className="tb-btn" aria-label="Maximize" title="Maximize" onClick={() => win().toggleMaximize()}>
          <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
            <rect x="2" y="2" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
        <button className="tb-btn tb-close" aria-label="Close" title="Close" onClick={() => win().close()}>
          <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
            <line x1="2.5" y1="2.5" x2="8.5" y2="8.5" stroke="currentColor" strokeWidth="1.2" />
            <line x1="8.5" y1="2.5" x2="2.5" y2="8.5" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
      </div>
    </div>
  )
}
