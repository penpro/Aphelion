import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { download } from '@tauri-apps/plugin-upload'
import { useStore } from '../store'
import { VISION_MODELS, findVisionModel } from '../visionModels'

/** Settings control: pick + download a vision model. Used by image tasks (runs as a
 * second engine). Large models may need to load/unload dynamically — warned below. */
export function VisionSettings() {
  const visionModel = useStore((s) => s.settings.visionModel)
  const updateSettings = useStore((s) => s.updateSettings)
  const [present, setPresent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pct, setPct] = useState(0)
  const [err, setErr] = useState('')

  const vm = findVisionModel(visionModel)

  useEffect(() => {
    if (!vm) {
      setPresent(false)
      return
    }
    let alive = true
    invoke<boolean>('vision_present', { textFile: vm.textFile, mmprojFile: vm.mmprojFile })
      .then((ok) => {
        if (alive) setPresent(ok)
      })
      .catch(() => {
        if (alive) setPresent(false)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visionModel])

  const downloadModel = async () => {
    if (!vm || busy) return
    setBusy(true)
    setErr('')
    setPct(0)
    try {
      const dir = await invoke<string | null>('model_dir_path')
      if (!dir) throw new Error('No model directory available.')
      // Two files; weight the bar roughly (text is the bulk, projector the tail).
      await download(vm.textUrl, `${dir}/${vm.textFile}`, (p) => {
        if (p.total > 0) setPct((p.progressTotal / p.total) * 90)
      })
      await download(vm.mmprojUrl, `${dir}/${vm.mmprojFile}`, (p) => {
        if (p.total > 0) setPct(90 + (p.progressTotal / p.total) * 10)
      })
      setPct(100)
      setPresent(true)
    } catch (e) {
      setErr((e as Error)?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <label className="field">
      <span>Vision model — lets the app "see" images</span>
      <select value={visionModel} onChange={(e) => updateSettings({ visionModel: e.target.value })}>
        <option value="">None — text only</option>
        {VISION_MODELS.map((v) => (
          <option key={v.id} value={v.id}>
            {v.label} · ~{v.approxGb} GB
          </option>
        ))}
      </select>
      {vm && (
        <div className="muted xs" style={{ marginTop: 6, lineHeight: 1.5 }}>
          <div>{vm.note}</div>
          <div style={{ marginTop: 6 }}>
            {present ? (
              <span style={{ color: 'var(--corona, #5EEAD4)' }}>✓ Downloaded and ready.</span>
            ) : busy ? (
              <span>Downloading… {Math.round(pct)}% (keep the app open)</span>
            ) : (
              <button className="btn sm" onClick={downloadModel}>
                ⬇ Download (~{vm.approxGb} GB)
              </button>
            )}
          </div>
          <div style={{ marginTop: 6, opacity: 0.9 }}>
            ⚠ The vision model runs as a separate engine and may <b>load and unload models dynamically</b> — a large one can
            briefly unload your main model while it works, so a reply may pause during the swap.
          </div>
          {err && <div style={{ color: '#ff6b6b', marginTop: 4 }}>{err}</div>}
        </div>
      )}
    </label>
  )
}
