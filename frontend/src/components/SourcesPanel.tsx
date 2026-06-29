import { useEffect, useRef, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { uid } from '../util'
import type { Source } from '../types'

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() || p

export function SourcesPanel({
  sources,
  onChange,
  folder,
  onSetFolder,
}: {
  sources: Source[]
  onChange: (s: Source[]) => void
  folder?: string
  onSetFolder?: (path: string | null) => void
}) {
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [adding, setAdding] = useState(false)
  const [folderInfo, setFolderInfo] = useState<{ files: number; chunks: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!folder) {
      setFolderInfo(null)
      return
    }
    let alive = true
    invoke<[number, number, string[]]>('folder_info', { path: folder })
      .then(([files, chunks]) => {
        if (alive) setFolderInfo({ files, chunks })
      })
      .catch(() => {
        if (alive) setFolderInfo(null)
      })
    return () => {
      alive = false
    }
  }, [folder])

  const pickFolder = async () => {
    try {
      const dir = await open({ directory: true, multiple: false, title: 'Choose a knowledge folder' })
      if (typeof dir === 'string') onSetFolder?.(dir)
    } catch {
      /* dialog cancelled or unavailable */
    }
  }

  const totalChars = sources.reduce((n, s) => n + s.text.length, 0)

  const add = () => {
    if (!text.trim()) return
    onChange([...sources, { id: uid(), name: name.trim() || `Source ${sources.length + 1}`, text: text.trim() }])
    setName('')
    setText('')
    setAdding(false)
  }

  const loadFiles = async (files: FileList | null) => {
    if (!files?.length) return
    const next = [...sources]
    for (const f of Array.from(files)) {
      try {
        const content = await f.text()
        if (content.trim()) next.push({ id: uid(), name: f.name, text: content })
      } catch {
        /* skip unreadable */
      }
    }
    onChange(next)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="sources">
      {onSetFolder && (
        <div className="kb-folder" style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
          {folder ? (
            <div className="source-row" title={folder}>
              <span className="source-name">📁 {baseName(folder)}</span>
              <span className="muted xs">{folderInfo ? `${folderInfo.files} files · ${folderInfo.chunks} chunks` : '…'}</span>
              <button className="icon-btn sm" title="Remove folder" onClick={() => onSetFolder(null)}>
                ✕
              </button>
            </div>
          ) : (
            <button className="btn sm ghost block" onClick={pickFolder}>
              📁 Grant a folder
            </button>
          )}
          <div className="muted xs" style={{ marginTop: 4 }}>
            A folder Aphelion can read reference docs from (PDF, .txt, .md…) and save the documents you generate into. Relevant
            passages are pulled into context each message — your files stay on disk; the model only ever sees what's retrieved.
          </div>
        </div>
      )}

      {sources.map((s) => (
        <div key={s.id} className="source-row" title={`${s.text.length.toLocaleString()} chars`}>
          <span className="source-name">📄 {s.name}</span>
          <span className="muted xs">{s.text.length >= 1000 ? `${Math.round(s.text.length / 1000)}k` : s.text.length}</span>
          <button className="icon-btn sm" title="Remove" onClick={() => onChange(sources.filter((x) => x.id !== s.id))}>
            ✕
          </button>
        </div>
      ))}
      {sources.length > 0 && (
        <div className="muted xs">≈ {Math.round(totalChars / 4).toLocaleString()} tokens kept in context</div>
      )}

      {adding ? (
        <div className="source-add">
          <input placeholder="name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
          <textarea
            placeholder="paste reference text — lore, a style sample, world notes…"
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="row gap">
            <button className="btn sm" onClick={add} disabled={!text.trim()}>
              Add
            </button>
            <button
              className="btn sm ghost"
              onClick={() => {
                setAdding(false)
                setName('')
                setText('')
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="row gap wrap">
          <button className="btn sm ghost" onClick={() => setAdding(true)}>
            + Paste source
          </button>
          <button className="btn sm ghost" onClick={() => fileRef.current?.click()}>
            📁 Load file
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.md,.markdown,.text,.csv,.json"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => loadFiles(e.target.files)}
          />
        </div>
      )}
    </div>
  )
}
