import { useState, type ReactNode } from 'react'
import { cx } from '../util'

/** A field label with a click-to-open ⓘ explainer — the compact replacement for always-visible
 *  helper paragraphs in dense panels. Renders the label row (text + ⓘ) and, when open, the
 *  explainer card right below it. Reuses the SettingsPanel infotip styling. */
export function TipLabel({ text, tip }: { text: ReactNode; tip: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <span className="tip-label">
        <span>{text}</span>
        <button
          type="button"
          className={cx('infotip-btn', open && 'on')}
          aria-expanded={open}
          aria-label={typeof text === 'string' ? `About ${text}` : 'More info'}
          onClick={() => setOpen((o) => !o)}
        >
          ⓘ
        </button>
      </span>
      {open && (
        <div className="infotip-pop">
          <div className="infotip-body">{tip}</div>
        </div>
      )}
    </>
  )
}
