import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getEngineStatus } from '../api/ollama'
import { useStore } from '../store'
import { Modal } from './Modal'
import { friendlyModelName } from '../models'

type MF = [string, number, boolean] // filename, size_bytes, is_loaded_main

const isMmproj = (n: string) => n.toLowerCase().includes('mmproj')
const gb = (n: number) => (n / 1024 / 1024 / 1024).toFixed(2)
const label = (name: string) =>
  isMmproj(name) ? `${friendlyModelName(name.replace(/-?mmproj.*/i, ''))} — projector` : friendlyModelName(name)

/** Manage downloaded models: switch the main text model (reloads the engine) or delete
 * files to reclaim disk space. */
export function ModelsModal({ onClose }: { onClose: () => void }) {
  const baseUrl = useStore((s) => s.settings.baseUrl)
  const updateSettings = useStore((s) => s.updateSettings)
  const setLoadedModel = useStore((s) => s.setLoadedModel)
  const [files, setFiles] = useState<MF[]>([])
  const [busy, setBusy] = useState('') // filename being acted on ('' = idle)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [err, setErr] = useState('')

  const refresh = () =>
    invoke<MF[]>('model_files')
      .then(setFiles)
      .catch(() => {})
  useEffect(() => {
    refresh()
  }, [])

  const load = async (name: string) => {
    setErr('')
    setBusy(name)
    try {
      await invoke('start_engine', { filename: name })
      updateSettings({ model: name })
      setLoadedModel(name)
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 1500))
        if ((await getEngineStatus(baseUrl)) === 'ready') break
      }
      refresh()
    } catch (e) {
      setErr((e as { message?: string })?.message ?? String(e))
    } finally {
      setBusy('')
    }
  }

  const del = async (name: string) => {
    setErr('')
    setConfirm(null)
    setBusy(name)
    try {
      await invoke('delete_model', { filename: name })
      refresh()
    } catch (e) {
      setErr((e as { message?: string })?.message ?? String(e))
    } finally {
      setBusy('')
    }
  }

  return (
    <Modal title="🗂 Manage models" onClose={onClose} wide>
      <p className="muted xs">
        Switch the main text model (reloads the engine, ~30s), or delete downloads to reclaim disk space. Vision models pair
        with a projector file; the loaded model can't be deleted — switch first.
      </p>
      {files.length === 0 && <div className="muted pad">No models found in your model folder.</div>}
      {files.map(([name, size, isMain]) => (
        <div key={name} className="source-row" style={{ alignItems: 'center', gap: 8 }}>
          <span className="source-name" title={name} style={{ flex: 1 }}>
            {isMain && '🟢 '}
            {label(name)}
          </span>
          <span className="muted xs">{gb(size)} GB</span>
          {!isMmproj(name) &&
            (isMain ? (
              <span className="muted xs">loaded</span>
            ) : (
              <button className="btn sm ghost" disabled={!!busy} onClick={() => load(name)}>
                {busy === name ? '…' : 'Load'}
              </button>
            ))}
          {isMain ? (
            <span style={{ width: 24 }} />
          ) : confirm === name ? (
            <span className="row gap">
              <button className="btn sm danger" disabled={!!busy} onClick={() => del(name)}>
                Delete
              </button>
              <button className="btn sm ghost" onClick={() => setConfirm(null)}>
                Cancel
              </button>
            </span>
          ) : (
            <button className="icon-btn sm" title="Delete" disabled={!!busy} onClick={() => setConfirm(name)}>
              🗑
            </button>
          )}
        </div>
      ))}
      {busy && (
        <div className="muted xs" style={{ marginTop: 8 }}>
          Working on {label(busy)}… (switching the main model reloads the engine — give it a moment)
        </div>
      )}
      {err && <div style={{ color: '#ff6b6b', marginTop: 8 }}>{err}</div>}
    </Modal>
  )
}
