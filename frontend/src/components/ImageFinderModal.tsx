import { useRef, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { setVisionMode, listImages, readImageData, saveDocument, openPath } from '../tauri'
import { useStore } from '../store'
import { classifyImage, getEngineStatus } from '../api/ollama'
import { findVisionModel } from '../visionModels'
import { Modal } from './Modal'

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() || p
type Phase = 'idle' | 'loading' | 'classifying' | 'building' | 'restoring' | 'done'

/** Find images in a folder that match a description (vision model), then embed the
 * matches in a PDF. Loads the vision model for the run and restores the main model after. */
export function ImageFinderModal({
  folder,
  onSetFolder,
  onClose,
  defaultCriterion,
}: {
  folder?: string
  onSetFolder: (path: string | null) => void
  onClose: () => void
  defaultCriterion?: string
}) {
  const settings = useStore((s) => s.settings)
  const setEngineMode = useStore((s) => s.setEngineMode)
  const [criterion, setCriterion] = useState(defaultCriterion ?? '')
  const [phase, setPhase] = useState<Phase>('idle')
  const [checked, setChecked] = useState(0)
  const [total, setTotal] = useState(0)
  const [matches, setMatches] = useState<string[]>([])
  const [err, setErr] = useState('')
  const [savedNote, setSavedNote] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const vm = findVisionModel(settings.visionModel)
  const baseUrl = settings.baseUrl
  const busy = phase !== 'idle' && phase !== 'done'

  const waitReady = async () => {
    for (let i = 0; i < 200; i++) {
      await new Promise((r) => setTimeout(r, 1500))
      try {
        if ((await getEngineStatus(baseUrl)) === 'ready') return
      } catch {
        /* keep waiting */
      }
    }
    throw new Error('Engine did not come back up.')
  }

  const pickFolder = async () => {
    try {
      const d = await open({ directory: true, multiple: false, title: 'Choose a folder of images' })
      if (typeof d === 'string') onSetFolder(d)
    } catch {
      /* cancelled */
    }
  }

  const restoreMain = async () => {
    try {
      await setVisionMode(false, vm?.textFile ?? '', vm?.mmprojFile ?? '')
      await waitReady()
      setEngineMode('text')
    } catch {
      /* best effort */
    }
  }

  const run = async () => {
    if (!folder) return setErr('Pick a folder of images first.')
    if (!criterion.trim()) return setErr('Say what to look for (e.g. "cats").')
    if (!vm) return setErr('Pick a vision model in Settings (the gear) first.')
    setErr('')
    setSavedNote('')
    setMatches([])
    setChecked(0)
    setTotal(0)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      setPhase('loading')
      await setVisionMode(true, vm.textFile, vm.mmprojFile)
      await waitReady()
      setEngineMode('image')
      const names = await listImages(folder)
      if (!names.length) throw new Error('No images found in that folder.')
      setTotal(names.length)
      setPhase('classifying')
      const found: string[] = []
      for (const name of names) {
        if (ctrl.signal.aborted) break
        try {
          const dataUrl = await readImageData(folder, name)
          if (await classifyImage(baseUrl, dataUrl, criterion.trim(), ctrl.signal)) {
            found.push(name)
            setMatches([...found])
          }
        } catch (e) {
          if ((e as { name?: string })?.name === 'AbortError') break
          /* skip an unreadable / failed image */
        }
        setChecked((c) => c + 1)
      }
      if (found.length && !ctrl.signal.aborted) {
        setPhase('building')
        const cells = found
          .map((n) => `[#image("${n}", width: 100%) #align(center, text(size: 8pt, fill: gray)[${n.replace(/[[\]]/g, '')}])]`)
          .join(',\n  ')
        const source = `#set page(margin: 1.6cm, numbering: "1")
#set text(font: "New Computer Modern", size: 11pt)

= ${criterion.trim()} — ${found.length} match${found.length === 1 ? '' : 'es'}

#grid(columns: (1fr, 1fr), gutter: 12pt,
  ${cells}
)
`
        const pdf = await saveDocument(folder, `${criterion.trim()} matches`, source)
        await openPath(pdf)
        setSavedNote(`Saved ${found.length} match${found.length === 1 ? '' : 'es'} to a PDF in ${baseName(folder)} · opened.`)
      } else if (!found.length) {
        setSavedNote('No matches found.')
      }
      setPhase('restoring')
      await restoreMain()
      setPhase('done')
    } catch (e) {
      const er = e as { name?: string; message?: string }
      if (er?.name !== 'AbortError') setErr(er?.message ?? String(e))
      setPhase('restoring')
      await restoreMain()
      setPhase('idle')
    } finally {
      abortRef.current = null
    }
  }

  const stop = () => abortRef.current?.abort()

  const phaseLabel: Record<Phase, string> = {
    idle: '',
    loading: 'Loading the vision model…',
    classifying: `Checking ${checked}/${total} — ${matches.length} match${matches.length === 1 ? '' : 'es'} so far`,
    building: 'Building the PDF…',
    restoring: 'Restoring your main model…',
    done: '',
  }

  return (
    <Modal title="🔎 Find images → PDF" onClose={onClose} wide>
      <p className="muted xs">
        Scan a folder of images with your vision model, keep the ones matching a description, and drop them into a PDF. The
        vision model loads for the run, then your main model is restored.
      </p>

      <div className="row gap" style={{ alignItems: 'center', margin: '4px 0 8px' }}>
        <span className="field-label" style={{ margin: 0 }}>
          <b>Folder</b>
        </span>
        {folder ? (
          <>
            <span className="source-name" title={folder} style={{ flex: 1 }}>
              📁 {baseName(folder)}
            </span>
            <button className="btn sm ghost" onClick={pickFolder} disabled={busy}>
              Change
            </button>
          </>
        ) : (
          <button className="btn sm ghost" onClick={pickFolder} disabled={busy}>
            📁 Choose a folder
          </button>
        )}
      </div>

      <input
        style={{ width: '100%' }}
        placeholder='What to find — e.g. "cats", "a dog", "screenshots with code", "people smiling"'
        value={criterion}
        onChange={(e) => setCriterion(e.target.value)}
      />

      <div className="row gap" style={{ marginTop: 10, alignItems: 'center' }}>
        {busy ? (
          <button className="btn sm" onClick={stop}>
            ■ Stop
          </button>
        ) : (
          <button className="btn" onClick={run} disabled={!folder || !criterion.trim()}>
            🔎 Find &amp; build PDF
          </button>
        )}
        {!vm && <span className="muted xs">No vision model selected — pick one in Settings.</span>}
        {busy && <span className="muted xs">{phaseLabel[phase]}</span>}
      </div>

      {phase === 'classifying' && total > 0 && (
        <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,.1)', marginTop: 10, overflow: 'hidden' }}>
          <div style={{ width: `${Math.round((checked / total) * 100)}%`, height: '100%', background: 'var(--corona, #5EEAD4)', transition: 'width .3s' }} />
        </div>
      )}

      {matches.length > 0 && (
        <div className="muted xs" style={{ marginTop: 10 }}>
          Matches: {matches.join(', ')}
        </div>
      )}
      {savedNote && (
        <div style={{ marginTop: 10, color: 'var(--corona, #5EEAD4)' }}>{savedNote}</div>
      )}
      {err && <div style={{ color: '#ff6b6b', marginTop: 10 }}>{err}</div>}
    </Modal>
  )
}
