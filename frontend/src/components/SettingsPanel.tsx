import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { useStore } from '../store'
import { listModels } from '../api/ollama'

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const [models, setModels] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = async () => {
    setLoading(true)
    setModels(await listModels(settings.baseUrl))
    setLoading(false)
  }
  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Modal
      title="Settings"
      onClose={onClose}
      footer={
        <div className="row gap full">
          <div className="grow" />
          <button className="btn" onClick={onClose}>
            Done
          </button>
        </div>
      }
    >
      <div className="form">
        <label className="field">
          <span>Engine API URL (bundled llama.cpp server)</span>
          <input value={settings.baseUrl} onChange={(e) => updateSettings({ baseUrl: e.target.value })} />
        </label>

        <label className="field">
          <span>Model</span>
          <div className="row gap">
            <select value={settings.model} onChange={(e) => updateSettings({ model: e.target.value })}>
              {!models.includes(settings.model) && <option value={settings.model}>{settings.model}</option>}
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <button className="btn sm ghost" onClick={refresh} disabled={loading}>
              {loading ? '…' : 'Refresh'}
            </button>
          </div>
        </label>

        <label className="field">
          <span>Temperature: {settings.temperature.toFixed(2)}</span>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={settings.temperature}
            onChange={(e) => updateSettings({ temperature: Number(e.target.value) })}
          />
        </label>

        <label className="field">
          <span>Top-p: {settings.topP.toFixed(2)}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={settings.topP}
            onChange={(e) => updateSettings({ topP: Number(e.target.value) })}
          />
        </label>

        <label className="field">
          <span>Max tokens (0 = unlimited)</span>
          <input
            type="number"
            min={0}
            value={settings.maxTokens}
            onChange={(e) => updateSettings({ maxTokens: Number(e.target.value) })}
          />
          <em className="hint">
            Keep this at 0. This is a reasoning model — a low cap gets eaten by the thinking phase, leaving an empty
            reply.
          </em>
        </label>

        <label className="field">
          <span>Context length (informational)</span>
          <input
            type="number"
            min={0}
            value={settings.contextLength}
            onChange={(e) => updateSettings({ contextLength: Number(e.target.value) })}
          />
          <em className="hint">Sent to the engine as num_ctx and used to trim the rolling context. Check VRAM before raising.</em>
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.autoExpandReasoning}
            onChange={(e) => updateSettings({ autoExpandReasoning: e.target.checked })}
          />
          <span>Auto-expand reasoning panels</span>
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.proofread}
            onChange={(e) => updateSettings({ proofread: e.target.checked })}
          />
          <span>Proofread replies (fix spelling &amp; grammar)</span>
        </label>
        <em className="hint">
          Re-runs each finished reply through the model to fix typos and grammar without changing the content. Roughly
          doubles generation time — off by default.
        </em>
      </div>
    </Modal>
  )
}
