import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { useStore } from '../store'
import { Modal } from './Modal'
import { generateTypstDoc, fixTypstDoc } from '../generators'
import { substituteMacros } from '../prompt'
import type { Chat } from '../types'

const checkStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }
const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() || p

/** Generate a document with the model (as Typst), compile it to a PDF, and save it into
 * the chat's granted folder (read + write) where it can be reopened later. */
export function DocumentModal({
  chat,
  charName,
  userName,
  onClose,
}: {
  chat: Chat
  charName: string
  userName: string
  onClose: () => void
}) {
  const settings = useStore((s) => s.settings)
  const updateChat = useStore((s) => s.updateChat)
  const [request, setRequest] = useState('')
  const [includeChat, setIncludeChat] = useState(chat.messages.length > 0)
  const [includeFolder, setIncludeFolder] = useState(!!chat.knowledgeFolder)
  const [typst, setTypst] = useState('')
  const [busy, setBusy] = useState<'idle' | 'generating' | 'compiling'>('idle')
  const [error, setError] = useState('')
  const [savedTo, setSavedTo] = useState('')
  const [docs, setDocs] = useState<string[]>([])
  const abortRef = useRef<AbortController | null>(null)

  const refreshDocs = (folder?: string) => {
    const f = folder ?? chat.knowledgeFolder
    if (!f) {
      setDocs([])
      return
    }
    invoke<string[]>('list_documents', { folder: f })
      .then(setDocs)
      .catch(() => setDocs([]))
  }
  useEffect(() => {
    refreshDocs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.knowledgeFolder])

  const buildContext = async (): Promise<string> => {
    const parts: string[] = []
    if (includeChat && chat.messages.length) {
      const lines: string[] = []
      if (chat.summary.trim()) lines.push(`Story so far: ${chat.summary.trim()}`, '')
      for (const m of chat.messages) {
        const who = m.role === 'user' ? userName : m.role === 'assistant' ? charName : 'System'
        lines.push(`${who}: ${substituteMacros(m.content, charName, userName)}`)
      }
      let t = lines.join('\n')
      if (t.length > 7000) t = '… (earlier omitted) …\n' + t.slice(-7000)
      parts.push(`Transcript of the current session:\n${t}`)
    }
    if (includeFolder && chat.knowledgeFolder) {
      try {
        const kb = await invoke<string>('retrieve_context', {
          path: chat.knowledgeFolder,
          query: request,
          maxChars: 4000,
        })
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
    setTypst('')
    setBusy('generating')
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const context = await buildContext()
      const result = await generateTypstDoc({
        request,
        context,
        settings,
        signal: ctrl.signal,
        onContent: (d) => setTypst((prev) => prev + d),
      })
      setTypst(result)
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
    (request.trim().split('\n')[0] || chat.title || 'document').replace(/[^\w -]+/g, '').trim().slice(0, 50) || 'document'

  // Ensure the chat has a granted read/write folder, prompting to pick one if not.
  const ensureFolder = async (): Promise<string | null> => {
    if (chat.knowledgeFolder) return chat.knowledgeFolder
    try {
      const dir = await open({ directory: true, multiple: false, title: 'Choose a folder for your documents' })
      if (typeof dir === 'string') {
        updateChat(chat.id, { knowledgeFolder: dir })
        return dir
      }
    } catch {
      /* cancelled */
    }
    return null
  }

  // Quick look: compile to a temp PDF and open it (no folder required).
  const preview = async () => {
    if (!typst.trim() || busy !== 'idle') return
    setError('')
    setBusy('compiling')
    try {
      const path = await invoke<string>('compile_typst', { source: typst, outPath: null })
      await invoke('open_path', { path })
    } catch (e) {
      const err = e as { message?: string }
      setError(typeof err?.message === 'string' ? err.message : String(e))
    } finally {
      setBusy('idle')
    }
  }

  // Persist: write <title>.typ + compile <title>.pdf into the granted folder, then open it.
  const saveToFolder = async () => {
    if (!typst.trim() || busy !== 'idle') return
    const folder = await ensureFolder()
    if (!folder) return
    setError('')
    setBusy('compiling')
    try {
      const pdf = await invoke<string>('save_document', { folder, title: titleGuess, source: typst })
      await invoke('open_path', { path: pdf })
      setSavedTo(folder)
      refreshDocs(folder)
    } catch (e) {
      const err = e as { message?: string }
      setError(typeof err?.message === 'string' ? err.message : String(e))
    } finally {
      setBusy('idle')
    }
  }

  const reopen = async (name: string) => {
    if (!chat.knowledgeFolder || busy !== 'idle') return
    try {
      const src = await invoke<string>('read_document', { folder: chat.knowledgeFolder, name })
      setTypst(src)
      setRequest((r) => r || name.replace(/\.typ$/i, ''))
      setError('')
      setSavedTo('')
    } catch (e) {
      setError(String(e))
    }
  }

  const fix = async () => {
    if (!typst.trim() || !error || busy !== 'idle') return
    const prevError = error
    const before = typst
    setBusy('generating')
    setError('')
    setTypst('')
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const result = await fixTypstDoc({
        source: before,
        error: prevError,
        settings,
        signal: ctrl.signal,
        onContent: (d) => setTypst((p) => p + d),
      })
      setTypst(result)
    } catch (e) {
      const err = e as { name?: string; message?: string }
      if (err?.name !== 'AbortError') {
        setError(err?.message ?? 'Fix failed')
        setTypst(before)
      }
    } finally {
      setBusy('idle')
      abortRef.current = null
    }
  }

  const folderLabel = chat.knowledgeFolder ? baseName(chat.knowledgeFolder) : ''

  return (
    <Modal title="📄 Create a document" onClose={onClose} wide>
      <p className="muted xs">
        Describe what you want — the model writes it as a clean <b>Typst</b> document and Aphelion compiles it to a PDF.
        Math, tables, and structure are supported, and it all runs locally. Saved documents go into your granted folder, where
        you can reopen them.
      </p>

      {chat.knowledgeFolder && docs.length > 0 && (
        <div style={{ margin: '6px 0 10px' }}>
          <div className="field-label">
            <b>📁 In {folderLabel}</b> <span className="muted">— click to reopen</span>
          </div>
          <div className="row gap wrap" style={{ marginTop: 4 }}>
            {docs.slice(0, 12).map((d) => (
              <button key={d} className="btn sm ghost" onClick={() => reopen(d)} disabled={busy !== 'idle'} title={d}>
                {d.replace(/\.typ$/i, '')}
              </button>
            ))}
          </div>
        </div>
      )}

      <textarea
        style={{ width: '100%', minHeight: 84, resize: 'vertical', fontFamily: 'inherit' }}
        placeholder="e.g. A one-page recap of this session as a formatted handout… / A two-page primer on photosynthesis with the key equation… / An NPC stat block for a fire giant as a clean table…"
        value={request}
        onChange={(e) => setRequest(e.target.value)}
      />
      <div className="row gap wrap" style={{ margin: '8px 0', alignItems: 'center' }}>
        {chat.messages.length > 0 && (
          <label style={checkStyle}>
            <input type="checkbox" checked={includeChat} onChange={(e) => setIncludeChat(e.target.checked)} /> Include this chat
          </label>
        )}
        {chat.knowledgeFolder && (
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

      {(typst || busy === 'generating') && (
        <>
          <div className="field-label" style={{ marginTop: 4 }}>
            <b>Typst source</b> <span className="muted">— edit freely before compiling</span>
          </div>
          <textarea
            className="mono"
            style={{ width: '100%', minHeight: 240, resize: 'vertical', fontSize: 12.5, lineHeight: 1.5 }}
            value={typst}
            onChange={(e) => setTypst(e.target.value)}
            spellCheck={false}
          />
          <div className="row gap wrap" style={{ marginTop: 8, alignItems: 'center' }}>
            <button className="btn sm ghost" onClick={preview} disabled={!typst.trim() || busy !== 'idle'}>
              {busy === 'compiling' ? 'Working…' : '👁 Preview'}
            </button>
            <button className="btn sm" onClick={saveToFolder} disabled={!typst.trim() || busy !== 'idle'}>
              💾 {chat.knowledgeFolder ? `Save to ${folderLabel}` : 'Save to a folder…'}
            </button>
            {error && (
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
