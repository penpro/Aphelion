import { useEffect, useRef, useState } from 'react'
import { expertIcon } from '../expertIcons'
import { cx } from '../util'
import type { Expert } from '../types'

// A small custom dropdown for choosing an Ask expert. Native <select> options can't hold images,
// so this renders the expert emblem (falling back to the emoji for custom experts) per row.
function ExpertGlyph({ expert }: { expert?: Expert }) {
  const icon = expertIcon(expert?.id)
  if (icon) return <img className="expert-glyph" src={icon} alt="" aria-hidden="true" />
  return (
    <span className="expert-glyph-emoji" aria-hidden="true">
      {expert?.emoji || '🪄'}
    </span>
  )
}

export function ExpertPicker({
  experts,
  value,
  onChange,
}: {
  experts: Expert[]
  value: string
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const current = experts.find((e) => e.id === value) ?? experts[0]

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div className="expert-picker" ref={ref}>
      <button type="button" className="expert-picker-btn" onClick={() => setOpen((o) => !o)} title="Choose an expert">
        <ExpertGlyph expert={current} />
        <span className="expert-picker-name">{current?.name ?? 'Expert'}</span>
        <span className="expert-picker-caret">▾</span>
      </button>
      {open && (
        <div className="expert-picker-menu">
          {experts.map((e) => (
            <button
              key={e.id}
              type="button"
              className={cx('expert-opt', e.id === value && 'sel')}
              onClick={() => {
                onChange(e.id)
                setOpen(false)
              }}
            >
              <ExpertGlyph expert={e} />
              <span>{e.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
