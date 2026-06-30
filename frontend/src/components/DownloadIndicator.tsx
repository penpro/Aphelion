import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { urlForFile } from '../visionModels'

interface DL {
  filename: string
  received: number
  total: number
  status: string
}

const short = (f: string) =>
  f
    .replace(/\.gguf$/i, '')
    .replace(/-Q4_K_M$/i, '')
    .replace(/-it$/i, '')
    .replace(/^gemma-3-/i, 'Gemma 3 ')

/** Compact inline download "sliver" for the sidebar foot — a peek at background model
 * downloads (downloading / resuming / paused / failed) with pause + resume. Renders
 * nothing when idle, so it never blocks the buttons around it. */
export function DownloadIndicator() {
  const [items, setItems] = useState<DL[]>([])

  useEffect(() => {
    let alive = true
    const tick = () =>
      invoke<DL[]>('download_status')
        .then((s) => alive && setItems(s))
        .catch(() => {})
    tick()
    const id = setInterval(tick, 1200)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  const active = items.filter((d) => d.status !== 'done')
  if (!active.length) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '2px 2px 4px' }}>
      {active.map(({ filename: name, received: recv, total, status }) => {
        const pct = total > 0 ? Math.round((recv / total) * 100) : 0
        const failed = status === 'failed'
        const running = status === 'downloading' || status === 'resuming'
        const label = failed ? 'failed' : status === 'resuming' ? `resuming ${pct}%` : status === 'paused' ? `paused ${pct}%` : `${pct}%`
        return (
          <div key={name} style={{ fontSize: 11 }} title={`${name} — ${status} · ${pct}%`}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.85 }}>
                ⬇ {short(name)}
              </span>
              <span className="muted" style={{ fontSize: 10 }}>
                {label}
              </span>
              {running ? (
                <button className="icon-btn sm" title="Pause" onClick={() => invoke('pause_download', { filename: name })}>
                  ⏸
                </button>
              ) : (
                <button
                  className="icon-btn sm"
                  title="Resume"
                  onClick={() => {
                    const u = urlForFile(name)
                    if (u) invoke('start_download', { url: u, filename: name })
                  }}
                >
                  ▶
                </button>
              )}
            </div>
            <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,.1)', marginTop: 3, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  background: failed ? '#ff6b6b' : 'var(--corona, #5EEAD4)',
                  transition: 'width .4s ease',
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
