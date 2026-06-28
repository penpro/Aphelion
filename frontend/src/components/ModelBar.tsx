import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { getEngineStatus } from '../api/ollama'
import { gpuVram } from '../tauri'
import { cx } from '../util'

type Status = 'down' | 'loading' | 'ready'

const LABEL: Record<Status, string> = {
  down: 'Starting engine…',
  loading: 'Loading model — please wait…',
  ready: 'Model ready',
}

/** Engine/model status + live VRAM gauge. The bundled engine owns the model for the
 *  app's whole lifetime, so there's nothing to load/unload — just show what's going on. */
export function ModelBar() {
  const baseUrl = useStore((s) => s.settings.baseUrl)
  const [status, setStatus] = useState<Status>('down')
  const [vram, setVram] = useState<{ used: number; total: number } | null>(null)

  useEffect(() => {
    let alive = true
    const tick = async () => {
      const [s, v] = await Promise.all([getEngineStatus(baseUrl), gpuVram()])
      if (!alive) return
      setStatus(s)
      setVram(v)
    }
    tick()
    const id = setInterval(tick, 2500)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [baseUrl])

  const dotColor = status === 'ready' ? '#3fb6a8' : status === 'loading' ? '#f5a623' : '#777'
  const usedGb = vram ? vram.used / 1024 : 0
  const totalGb = vram ? vram.total / 1024 : 0
  const pct = vram && vram.total > 0 ? Math.min(100, (vram.used / vram.total) * 100) : 0

  return (
    <div className="model-bar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{ width: 9, height: 9, borderRadius: '50%', background: dotColor, flex: '0 0 auto' }}
          title={LABEL[status]}
        />
        <span className={cx('xs', status !== 'ready' && 'muted')}>{LABEL[status]}</span>
      </div>
      {vram && (
        <div style={{ marginTop: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="muted xs">VRAM</span>
            <span className="xs">
              {usedGb.toFixed(1)} / {totalGb.toFixed(1)} GB
            </span>
          </div>
          <div style={{ height: 4, background: '#2a2f3a', borderRadius: 2, overflow: 'hidden', marginTop: 3 }}>
            <div
              style={{
                height: '100%',
                width: pct + '%',
                background: pct > 92 ? '#e5534b' : '#3fb6a8',
                transition: 'width .4s ease',
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
