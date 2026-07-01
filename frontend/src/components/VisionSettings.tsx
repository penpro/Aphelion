import { useEffect, useState } from 'react'
import { visionPresent, downloadStatus, startDownload as startDownloadCmd, pauseDownload, type DownloadInfo } from '../tauri'
import { useStore } from '../store'
import { VISION_MODELS, findVisionModel } from '../visionModels'

/** Settings control: pick + download (resumable, background) a vision model for image tasks. */
export function VisionSettings() {
  const visionModel = useStore((s) => s.settings.visionModel)
  const updateSettings = useStore((s) => s.updateSettings)
  const [present, setPresent] = useState(false)
  const [dls, setDls] = useState<DownloadInfo[]>([])
  const [err, setErr] = useState('')

  const vm = findVisionModel(visionModel)

  useEffect(() => {
    if (!vm) {
      setPresent(false)
      return
    }
    let alive = true
    const tick = async () => {
      try {
        const ok = await visionPresent(vm.textFile, vm.mmprojFile)
        if (alive) setPresent(ok)
      } catch {
        if (alive) setPresent(false)
      }
      try {
        const status = await downloadStatus()
        if (alive) setDls(status)
      } catch {
        /* ignore */
      }
    }
    tick()
    const id = setInterval(tick, 1500)
    return () => {
      alive = false
      clearInterval(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visionModel])

  // Combined progress for this model's two files (text + projector).
  const mine = vm ? dls.filter((d) => d.filename === vm.textFile || d.filename === vm.mmprojFile) : []
  const received = mine.reduce((n, d) => n + d.received, 0)
  const total = mine.reduce((n, d) => n + d.total, 0)
  const anyActive = mine.some((d) => d.status === 'downloading' || d.status === 'resuming')
  const anyResuming = mine.some((d) => d.status === 'resuming')
  const anyPaused = mine.some((d) => d.status === 'paused')
  const anyFailed = mine.some((d) => d.status === 'failed')
  const pct = total > 0 ? Math.round((received / total) * 100) : 0

  const startDownload = async () => {
    if (!vm) return
    setErr('')
    try {
      await startDownloadCmd(vm.textUrl, vm.textFile)
      await startDownloadCmd(vm.mmprojUrl, vm.mmprojFile)
    } catch (e) {
      setErr((e as Error)?.message ?? String(e))
    }
  }
  const pause = async () => {
    if (!vm) return
    await pauseDownload(vm.textFile)
    await pauseDownload(vm.mmprojFile)
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
            ) : anyActive ? (
              <span>
                {anyResuming ? 'Resuming' : 'Downloading'}… {pct}%{' '}
                <button className="btn sm ghost" onClick={pause}>
                  ⏸ Pause
                </button>
              </span>
            ) : anyPaused || anyFailed ? (
              <span>
                {anyFailed ? 'Failed' : 'Paused'} at {pct}%{' '}
                <button className="btn sm" onClick={startDownload}>
                  ▶ Resume
                </button>
              </span>
            ) : (
              <button className="btn sm" onClick={startDownload}>
                ⬇ Download (~{vm.approxGb} GB)
              </button>
            )}
          </div>
          <div style={{ marginTop: 6, opacity: 0.9 }}>
            ⚠ The vision model runs as a separate engine and may load/unload models dynamically — a large one can briefly
            unload your main model while it works. Downloads resume automatically and run in the background (progress shows
            bottom-left).
          </div>
          {err && <div style={{ color: '#ff6b6b', marginTop: 4 }}>{err}</div>}
        </div>
      )}
    </label>
  )
}
