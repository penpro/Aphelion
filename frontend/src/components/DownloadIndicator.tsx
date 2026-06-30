import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { urlForFile } from '../visionModels'

type DL = [string, number, number, string] // filename, received, total, status

const short = (f: string) =>
  f
    .replace(/\.gguf$/i, '')
    .replace(/-Q4_K_M$/i, '')
    .replace(/-it$/i, '')
const gb = (n: number) => (n / 1024 / 1024 / 1024).toFixed(1)

/** Floating status pill on the main screen for background model downloads
 * (downloading / resuming / paused / failed), with pause + resume controls. */
export function DownloadIndicator() {
  const [items, setItems] = useState<DL[]>([])

  useEffect(() => {
    let alive = true
    const tick = () =>
      invoke<DL[]>('download_status')
        .then((s) => alive && setItems(s))
        .catch(() => {})
    tick()
    const id = setInterval(tick, 1500)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [])

  const active = items.filter(([, , , s]) => s !== 'done')
  if (!active.length) return null

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 14,
        left: 14,
        zIndex: 60,
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        width: 300,
      }}
    >
      {active.map(([name, recv, total, status]) => {
        const pct = total > 0 ? Math.round((recv / total) * 100) : 0
        return (
          <div
            key={name}
            style={{
              background: 'var(--panel, #130A30)',
              border: '1px solid var(--border, #2a2342)',
              borderRadius: 10,
              padding: '8px 10px',
              fontSize: 12,
              boxShadow: '0 6px 22px rgba(0,0,0,.45)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                ⬇ {short(name)}
              </span>
              <span className="muted" style={{ marginLeft: 'auto', textTransform: 'capitalize' }}>
                {status}
              </span>
            </div>
            <div style={{ height: 6, background: 'rgba(255,255,255,.08)', borderRadius: 4, margin: '6px 0', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${pct}%`,
                  height: '100%',
                  background: status === 'failed' ? '#ff6b6b' : 'var(--corona, #5EEAD4)',
                  transition: 'width .4s ease',
                }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="muted">{total > 0 ? `${gb(recv)} / ${gb(total)} GB · ${pct}%` : `${gb(recv)} GB`}</span>
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                {(status === 'downloading' || status === 'resuming') && (
                  <button className="btn sm ghost" title="Pause" onClick={() => invoke('pause_download', { filename: name })}>
                    ⏸
                  </button>
                )}
                {(status === 'paused' || status === 'failed') && (
                  <button
                    className="btn sm ghost"
                    title="Resume"
                    onClick={() => {
                      const url = urlForFile(name)
                      if (url) invoke('start_download', { url, filename: name })
                    }}
                  >
                    ▶
                  </button>
                )}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
