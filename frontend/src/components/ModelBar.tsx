import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { getEngineStatus, listModels } from '../api/ollama'
import { friendlyModelName } from '../models'
import { gpuVram } from '../tauri'
import { cx } from '../util'

type Status = 'down' | 'loading' | 'ready'

const LABEL: Record<Status, string> = {
  down: 'Starting engine…',
  loading: 'Loading model — please wait…',
  ready: 'Ready',
}

/** Engine/model status + live model name + VRAM gauge. The bundled engine owns the
 *  model for the app's whole lifetime, so there's nothing to load/unload — just show
 *  what's running. */
export function ModelBar() {
  const baseUrl = useStore((s) => s.settings.baseUrl)
  const fallback = useStore((s) => s.settings.model)
  const loadedModel = useStore((s) => s.loadedModel)
  const setLoadedModel = useStore((s) => s.setLoadedModel)
  const [status, setStatus] = useState<Status>('down')
  const [vram, setVram] = useState<{ used: number; total: number } | null>(null)

  useEffect(() => {
    let alive = true
    const tick = async () => {
      const [s, v, models] = await Promise.all([getEngineStatus(baseUrl), gpuVram(), listModels(baseUrl)])
      if (!alive) return
      setStatus(s)
      setVram(v)
      setLoadedModel(models[0] ?? null)
    }
    tick()
    const id = setInterval(tick, 2500)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [baseUrl, setLoadedModel])

  const dotColor = status === 'ready' ? 'var(--accent)' : status === 'loading' ? 'var(--warn)' : '#6d5b8e'
  const usedGb = vram ? vram.used / 1024 : 0
  const totalGb = vram ? vram.total / 1024 : 0
  const pct = vram && vram.total > 0 ? Math.min(100, (vram.used / vram.total) * 100) : 0
  const modelName = friendlyModelName(loadedModel || fallback)

  return (
    <div className="model-bar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className={cx('status-dot', status === 'ready' && 'live')} style={{ background: dotColor }} title={LABEL[status]} />
        <span className="model-name" title={loadedModel || fallback}>
          {modelName}
        </span>
      </div>
      <div className={cx('xs', status !== 'ready' && 'muted')} style={{ marginTop: 2 }}>
        {LABEL[status]}
      </div>
      {vram && (
        <div style={{ marginTop: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span className="muted xs">VRAM</span>
            <span className="xs">
              {usedGb.toFixed(1)} / {totalGb.toFixed(1)} GB
            </span>
          </div>
          <div className="vram-track">
            <div className="vram-fill" style={{ width: pct + '%', background: pct > 92 ? 'var(--danger)' : 'var(--accent)' }} />
          </div>
        </div>
      )}
    </div>
  )
}
