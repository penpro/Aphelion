import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { useStore } from '../store'
import { Modal } from './Modal'
import { generateTypstDoc, generateTextDoc, fixTypstDoc } from '../generators'

const checkStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }
const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() || p

type Fmt = { id: string; label: string; ext: string; lang: string; typst?: boolean }
const FORMATS: Fmt[] = [
  { id: 'pdf', label: 'PDF (Typst)', ext: 'pdf', lang: 'Typst', typst: true },
  { id: 'md', label: 'Markdown', ext: 'md', lang: 'Markdown' },
  { id: 'html', label: 'HTML', ext: 'html', lang: 'standalone HTML' },
  { id: 'txt', label: 'Plain text', ext: 'txt', lang: 'plain text' },
  { id: 'java', label: 'Java', ext: 'java', lang: 'Java' },
  { id: 'py', label: 'Python', ext: 'py', lang: 'Python' },
  { id: 'js', label: 'JavaScript', ext: 'js', lang: 'JavaScript' },
  { id: 'ts', label: 'TypeScript', ext: 'ts', lang: 'TypeScript' },
  { id: 'css', label: 'CSS', ext: 'css', lang: 'CSS' },
  { id: 'json', label: 'JSON', ext: 'json', lang: 'JSON' },
  { id: 'csv', label: 'CSV', ext: 'csv', lang: 'CSV' },
  { id: 'sql', label: 'SQL', ext: 'sql', lang: 'SQL' },
  { id: 'yaml', label: 'YAML', ext: 'yaml', lang: 'YAML' },
  { id: 'xml', label: 'XML', ext: 'xml', lang: 'XML' },
]

/** Generate a document with the model — a PDF (via Typst) or a plain-text / code file —
 * and save it into a granted read/write folder where it can be reopened. Shared by the
 * roleplay chat and the Ask view via generic props. */
export function DocumentModal({
  folder,
  onSetFolder,
  defaultTitle,
  defaultExpertId,
  transcript,
  onClose,
}: {
  folder?: string
  onSetFolder: (path: string | null) => void
  defaultTitle: string
  defaultExpertId?: string | null
  transcript?: { label: string; has: boolean; build: () => string }
  onClose: () => void
}) {
  const settings = useStore((s) => s.settings)
  const experts = useStore((s) => s.experts)
  const [request, setRequest] = useState('')
  const [format, setFormat] = useState<Fmt>(FORMATS[0])
  const [expertId, setExpertId] = useState<string>(defaultExpertId ?? 'plain')
  const [includeChat, setIncludeChat] = useState(!!transcript?.has)
  const [includeFolder, setIncludeFolder] = useState(!!folder)
  const [content, setContent] = useState('')
  const [docName, setDocName] = useState('') // set when a saved doc is reopened, so Save writes back to it
  const [busy, setBusy] = useState<'idle' | 'generating' | 'compiling'>('idle')
  const [error, setError] = useState('')
  const [savedTo, setSavedTo] = useState('')
  const [docs, setDocs] = useState<string[]>([])
  const abortRef = useRef<AbortController | null>(null)

  const refreshDocs = (f?: string) => {
    const dir = f ?? folder
    if (!dir) {
      setDocs([])
      return
    }
    invoke<string[]>('list_documents', { folder: dir })
      .then(setDocs)
      .catch(() => setDocs([]))
  }
  useEffect(() => {
    refreshDocs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder])

  const buildContext = async (): Promise<string> => {
    const parts: string[] = []
    if (includeChat && transcript) {
      let t = transcript.build()
      if (t.length > 7000) t = '… (earlier omitted) …\n' + t.slice(-7000)
      if (t.trim()) parts.push(`Transcript of ${transcript.label}:\n${t}`)
    }
    if (includeFolder && folder) {
      try {
        const kb = await invoke<string>('retrieve_context', { path: folder, query: request, maxChars: 4000 })
        if (kb.trim()) parts.push(`From the folder:\n${kb}`)
      } catch {
        /* folder unavailable — skip */
      }
    }
    return parts.join('\n\n')
  }

  const generate = async () => {
    if (!request.trim() || busy !== 'idle') return
    setError('')
    setSavedTo('')
    setContent('')
    setDocName('')
    setBusy('generating')
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const context = await buildContext()
      const persona = expertId === 'plain' ? undefined : experts.find((e) => e.id === expertId)?.systemPrompt
      const common = { request, context, persona, settings, signal: ctrl.signal, onContent: (d: string) => setContent((p) => p + d) }
      const result = format.typst
        ? await generateTypstDoc(common)
        : await generateTextDoc({ ...common, fileType: format.lang })
      setContent(result)
    } catch (e) {
      const err = e as { name?: string; message?: string }
      if (err?.name !== 'AbortError') setError(err?.message ?? 'Generation failed')
    } finally {
      setBusy('idle')
      abortRef.current = null
    }
  }

  const stop = () => abortRef.current?.abort()

  const titleGuess =
    (request.trim().split('\n')[0] || defaultTitle || 'document').replace(/[^\w -]+/g, '').trim().slice(0, 50) || 'document'
  const saveTitle = docName || titleGuess

  // Ensure a granted read/write folder, prompting to pick one if not.
  const ensureFolder = async (): Promise<string | null> => {
    if (folder) return folder
    try {
      const dir = await open({ directory: true, multiple: false, title: 'Choose a folder for your documents' })
      if (typeof dir === 'string') {
        onSetFolder(dir)
        return dir
      }
    } catch {
      /* cancelled */
    }
    return null
  }

  // Quick look without saving: PDF → temp compile; text/code → temp file in its default app.
  const preview = async () => {
    if (!content.trim() || busy !== 'idle') return
    setError('')
    setBusy('compiling')
    try {
      const path = format.typst
        ? await invoke<string>('compile_typst', { source: content, outPath: null })
        : await invoke<string>('write_temp_file', { name: `${saveTitle}.${format.ext}`, content })
      await invoke('open_path', { path })
    } catch (e) {
      const err = e as { message?: string }
      setError(typeof err?.message === 'string' ? err.message : String(e))
    } finally {
      setBusy('idle')
    }
  }

  // Persist into the granted folder, then open the result.
  const saveToFolder = async () => {
    if (!content.trim() || busy !== 'idle') return
    const dir = await ensureFolder()
    if (!dir) return
    setError('')
    setBusy('compiling')
    try {
      const path = format.typst
        ? await invoke<string>('save_document', { folder: dir, title: saveTitle, source: content })
        : await invoke<string>('save_text_document', { folder: dir, title: saveTitle, ext: format.ext, content })
      await invoke('open_path', { path })
      setSavedTo(dir)
      refreshDocs(dir)
    } catch (e) {
      const err = e as { message?: string }
      setError(typeof err?.message === 'string' ? err.message : String(e))
    } finally {
      setBusy('idle')
    }
  }

  const reopen = async (name: string) => {
    if (!folder || busy !== 'idle') return
    try {
      const src = await invoke<string>('read_document', { folder, name })
      const ext = (name.split('.').pop() || '').toLowerCase()
      const fmt: Fmt =
        ext === 'typ'
          ? FORMATS[0]
          : FORMATS.find((f) => f.ext === ext) ?? { id: ext || 'txt', label: (ext || 'text').toUpperCase(), ext: ext || 'txt', lang: 'plain text' }
      setFormat(fmt)
      setContent(src)
      setDocName(name.replace(/\.[^.]+$/, ''))
      setError('')
      setSavedTo('')
    } catch (e) {
      setError(String(e))
    }
  }

  const fix = async () => {
    if (!content.trim() || !error || busy !== 'idle') return
    const prevError = error
    const before = content
    setBusy('generating')
    setError('')
    setContent('')
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const result = await fixTypstDoc({
        source: before,
        error: prevError,
        settings,
        signal: ctrl.signal,
        onContent: (d) => setContent((p) => p + d),
      })
      setContent(result)
    } catch (e) {
      const err = e as { name?: string; message?: string }
      if (err?.name !== 'AbortError') {
        setError(err?.message ?? 'Fix failed')
        setContent(before)
      }
    } finally {
      setBusy('idle')
      abortRef.current = null
    }
  }

  const folderLabel = folder ? baseName(folder) : ''

  return (
    <Modal title="📄 Create a document" onClose={onClose} wide>
      <p className="muted xs">
        Describe what you want — the model writes it as a <b>PDF</b> (via Typst, with math &amp; tables) or as a plain-text /
        code file an IDE can open. Saved documents go into your granted folder, where you can reopen them. It all runs locally.
      </p>

      {folder && docs.length > 0 && (
        <div style={{ margin: '6px 0 10px' }}>
          <div className="field-label">
            <b>📁 In {folderLabel}</b> <span className="muted">— click to reopen</span>
          </div>
          <div className="row gap wrap" style={{ marginTop: 4 }}>
            {docs.slice(0, 14).map((d) => (
              <button key={d} className="btn sm ghost" onClick={() => reopen(d)} disabled={busy !== 'idle'} title={d}>
                {d}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="row gap" style={{ alignItems: 'center', margin: '2px 0 8px', flexWrap: 'wrap' }}>
        <span className="field-label" style={{ margin: 0 }}>
          <b>Format</b>
        </span>
        <select value={format.id} onChange={(e) => setFormat(FORMATS.find((f) => f.id === e.target.value) ?? FORMATS[0])}>
          {FORMATS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
        <span className="field-label" style={{ margin: '0 0 0 6px' }}>
          <b>Writer</b>
        </span>
        <select
          value={expertId}
          onChange={(e) => setExpertId(e.target.value)}
          title="Which expert's instructions shape the content (the format rules are always enforced)"
        >
          <option value="plain">Plain (format only)</option>
          {experts.map((ex) => (
            <option key={ex.id} value={ex.id}>
              {(ex.emoji ? ex.emoji + ' ' : '') + ex.name}
            </option>
          ))}
        </select>
      </div>

      <textarea
        style={{ width: '100%', minHeight: 84, resize: 'vertical', fontFamily: 'inherit' }}
        placeholder={
          format.typst
            ? 'e.g. A one-page recap as a formatted handout… / A primer on photosynthesis with the key equation…'
            : `e.g. A ${format.label} file that… (a character-sheet web page, a dice-roller class, a data file…)`
        }
        value={request}
        onChange={(e) => setRequest(e.target.value)}
      />
      <div className="row gap wrap" style={{ margin: '8px 0', alignItems: 'center' }}>
        {transcript?.has && (
          <label style={checkStyle}>
            <input type="checkbox" checked={includeChat} onChange={(e) => setIncludeChat(e.target.checked)} /> Include{' '}
            {transcript.label}
          </label>
        )}
        {folder && (
          <label style={checkStyle}>
            <input type="checkbox" checked={includeFolder} onChange={(e) => setIncludeFolder(e.target.checked)} /> Use folder as
            reference
          </label>
        )}
        <div style={{ flex: 1 }} />
        {busy === 'generating' ? (
          <button className="btn sm" onClick={stop}>
            ■ Stop
          </button>
        ) : (
          <button className="btn sm" onClick={generate} disabled={!request.trim() || busy !== 'idle'}>
            ✨ Generate
          </button>
        )}
      </div>

      {(content || busy === 'generating') && (
        <>
          <div className="field-label" style={{ marginTop: 4 }}>
            <b>{format.typst ? 'Typst source' : `${format.label} content`}</b>{' '}
            <span className="muted">— edit freely before saving</span>
          </div>
          <textarea
            className="mono"
            style={{ width: '100%', minHeight: 240, resize: 'vertical', fontSize: 12.5, lineHeight: 1.5 }}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            spellCheck={false}
          />
          <div className="row gap wrap" style={{ marginTop: 8, alignItems: 'center' }}>
            <button className="btn sm ghost" onClick={preview} disabled={!content.trim() || busy !== 'idle'}>
              {busy === 'compiling' ? 'Working…' : format.typst ? '👁 Preview' : '↗ Open'}
            </button>
            <button className="btn sm" onClick={saveToFolder} disabled={!content.trim() || busy !== 'idle'}>
              💾 {folder ? `Save to ${folderLabel}` : 'Save to a folder…'}
            </button>
            {format.typst && error && (
              <button
                className="btn sm ghost"
                onClick={fix}
                disabled={busy !== 'idle'}
                title="Send the error back to the model to repair"
              >
                🔧 Fix with AI
              </button>
            )}
            {savedTo && <span className="muted xs">Saved to {baseName(savedTo)} · opened</span>}
          </div>
        </>
      )}

      {error && (
        <pre
          style={{
            marginTop: 10,
            padding: 10,
            background: 'rgba(255,90,90,.08)',
            border: '1px solid rgba(255,90,90,.32)',
            borderRadius: 8,
            fontSize: 12,
            whiteSpace: 'pre-wrap',
            maxHeight: 170,
            overflow: 'auto',
          }}
        >
          {error}
        </pre>
      )}
    </Modal>
  )
}
