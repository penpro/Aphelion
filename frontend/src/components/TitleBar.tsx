import { getCurrentWindow } from '@tauri-apps/api/window'
import { CoronaMark } from './CoronaMark'
import { useStore } from '../store'
import { cx } from '../util'
import { UI_ICONS } from '../uiIcons'
import type { AppView } from '../types'

const MODES: { id: AppView; label: string; icon: string }[] = [
  { id: 'chat', label: 'Chat', icon: UI_ICONS.chat },
  { id: 'story', label: 'Story', icon: UI_ICONS.story },
  { id: 'tree', label: 'Trees', icon: UI_ICONS.trees },
  { id: 'ask', label: 'Ask', icon: UI_ICONS.ask },
]

// The main menu bar: brand + the hero mode tabs + window controls. The window uses
// decorations:false, so the bar surface is a Tauri drag region and the controls call the window
// API. getCurrentWindow() is resolved lazily so a non-Tauri context (browser dev) doesn't fault.
export function TitleBar() {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const win = () => getCurrentWindow()
  return (
    <div className="topbar" data-tauri-drag-region>
      <div className="topbar-brand" data-tauri-drag-region>
        <CoronaMark size={20} />
        <span>Aphelion</span>
      </div>
      <nav className="topbar-modes">
        {MODES.map((m) => (
          <button key={m.id} className={cx('mode-tab', view === m.id && 'active')} onClick={() => setView(m.id)}>
            <img src={m.icon} alt="" aria-hidden="true" />
            <span>{m.label}</span>
          </button>
        ))}
      </nav>
      <div className="topbar-spacer" data-tauri-drag-region />
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
