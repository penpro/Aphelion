import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { download } from '@tauri-apps/plugin-upload'
import { MODEL_CATALOG, recommendModel } from '../models'
import { getEngineStatus } from '../api/ollama'
import { useStore } from '../store'

type Phase = 'choose' | 'downloading' | 'starting'

/** First-run wizard: detect VRAM → recommend a model → download → start the engine. */
export function SetupWizard({ onReady }: { onReady: () => void }) {
  const baseUrl = useStore((s) => s.settings.baseUrl)
  const [vramMb, setVramMb] = useState<number | null>(null)
  const [selected, setSelected] = useState('gemma3-4b')
  const [phase, setPhase] = useState<Phase>('choose')
  const [pct, setPct] = useState(0)
  const [error, setError] = useState('')

  useEffect(() => {
    invoke<number | null>('vram_total_mb')
      .then((mb) => {
        setVramMb(mb ?? null)
        setSelected(recommendModel(mb ? mb / 1024 : null))
      })
      .catch(() => {})
  }, [])

  const vramGb = vramMb ? vramMb / 1024 : null
  const recId = recommendModel(vramGb)
  const model = MODEL_CATALOG.find((m) => m.id === selected)

  const go = async () => {
    if (!model) return
    setError('')
    setPhase('downloading')
    setPct(0)
    try {
      const dir = await invoke<string | null>('model_dir_path')
      if (!dir) throw new Error('No model directory available.')
      await download(model.url, `${dir}/${model.filename}`, (p) => {
        if (p.total > 0) setPct((p.progressTotal / p.total) * 100)
      })
      setPhase('starting')
      await invoke('start_engine', { filename: model.filename })
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 1500))
        if ((await getEngineStatus(baseUrl)) === 'ready') break
      }
      onReady()
    } catch (e) {
      setError((e as Error)?.message ?? String(e))
      setPhase('choose')
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(8,10,14,0.85)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 20,
      }}
    >
      <div
        style={{
          background: '#15181f',
          border: '1px solid #2a2f3a',
          borderRadius: 12,
          padding: 24,
          width: '100%',
          maxWidth: 560,
          boxShadow: '0 20px 60px rgba(0,0,0,.5)',
        }}
      >
        <h1 style={{ margin: '0 0 6px' }}>🪄 Welcome to LocalLLM Studio</h1>
        <p className="muted" style={{ marginTop: 0 }}>
          Pick a model to download — it runs entirely on your machine, private and offline.{' '}
          {vramGb
            ? `Detected GPU memory: ${vramGb.toFixed(1)} GB.`
            : 'No NVIDIA GPU detected — a small model is recommended.'}
        </p>

        {phase === 'choose' && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '14px 0' }}>
              {MODEL_CATALOG.map((m) => {
                const fits = !vramGb || m.minVramGb <= vramGb
                return (
                  <button
                    key={m.id}
                    onClick={() => setSelected(m.id)}
                    style={{
                      textAlign: 'left',
                      padding: '10px 12px',
                      borderRadius: 8,
                      cursor: 'pointer',
                      color: 'inherit',
                      border: selected === m.id ? '1px solid #7c5cff' : '1px solid #2a2f3a',
                      background: selected === m.id ? 'rgba(124,92,255,.12)' : 'transparent',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                      <strong>
                        {m.name}
                        {m.id === recId && <span style={{ color: '#3fb6a8', fontSize: 12 }}> ★ Recommended</span>}
                      </strong>
                      <span className="muted xs">{m.sizeGb.toFixed(1)} GB</span>
                    </div>
                    <div className="muted xs" style={{ marginTop: 2 }}>
                      {m.note}
                      {!fits && ` · needs ~${m.minVramGb} GB VRAM — will run, but slowly on yours`}
                    </div>
                  </button>
                )
              })}
            </div>
            {error && <div className="error-line">{error}</div>}
            <button className="btn" onClick={go} disabled={!model}>
              Download &amp; start{model ? ` (${model.sizeGb.toFixed(1)} GB)` : ''}
            </button>
          </>
        )}

        {phase === 'downloading' && (
          <div style={{ margin: '18px 0' }}>
            <p style={{ marginBottom: 8 }}>
              Downloading {model?.name} — {pct.toFixed(0)}%
            </p>
            <div style={{ height: 8, background: '#2a2f3a', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: pct + '%', background: '#7c5cff', transition: 'width .3s ease' }} />
            </div>
            <p className="muted xs" style={{ marginTop: 8 }}>
              One-time download. Keep the app open.
            </p>
          </div>
        )}

        {phase === 'starting' && (
          <div style={{ margin: '18px 0' }}>
            <p>Starting the engine and loading the model into your GPU…</p>
            <p className="muted xs">First load takes ~15–30 seconds.</p>
          </div>
        )}
      </div>
    </div>
  )
}
