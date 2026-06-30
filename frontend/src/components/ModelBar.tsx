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
  const contextLength = useStore((s) => s.settings.contextLength)
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
  const ctxLabel = contextLength >= 1024 ? `${Math.round(contextLength / 1024)}K` : String(contextLength)

  return (
    <div className="topbar-stats">
      <span className={cx('status-dot', status === 'ready' && 'live')} style={{ background: dotColor }} title={LABEL[status]} />
      <span className="ts-model" title={loadedModel || fallback}>
        {modelName}
      </span>
      {vram && (
        <span className="ts-chip" title={`VRAM ${usedGb.toFixed(1)} / ${totalGb.toFixed(1)} GB`}>
          <span className="ts-k">VRAM</span>
          <span className="ts-bar">
            <i style={{ width: pct + '%', background: pct > 92 ? 'var(--danger)' : 'var(--accent)' }} />
          </span>
          <span className="ts-v">
            {usedGb.toFixed(1)}/{totalGb.toFixed(0)}
          </span>
        </span>
      )}
      <span className="ts-chip" title="Context window">
        <span className="ts-k">CTX</span>
        <span className="ts-v">{ctxLabel}</span>
      </span>
    </div>
  )
}
