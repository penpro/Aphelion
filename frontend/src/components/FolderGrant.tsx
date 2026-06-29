import { useEffect, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() || p

/** Grant the app a read/write folder: reference docs are read from it, generated
 * documents are saved into it. Used by both the roleplay chat and the Ask view. */
export function FolderGrant({
  folder,
  onSetFolder,
  compact,
}: {
  folder?: string
  onSetFolder: (path: string | null) => void
  compact?: boolean
}) {
  const [info, setInfo] = useState<{ files: number; chunks: number } | null>(null)

  useEffect(() => {
    if (!folder) {
      setInfo(null)
      return
    }
    let alive = true
    invoke<[number, number, string[]]>('folder_info', { path: folder })
      .then(([files, chunks]) => {
        if (alive) setInfo({ files, chunks })
      })
      .catch(() => {
        if (alive) setInfo(null)
      })
    return () => {
      alive = false
    }
  }, [folder])

  const pick = async () => {
    try {
      const dir = await open({ directory: true, multiple: false, title: 'Choose a folder' })
      if (typeof dir === 'string') onSetFolder(dir)
    } catch {
      /* cancelled or unavailable */
    }
  }

  if (folder) {
    return (
      <span className="row gap" style={{ alignItems: 'center' }} title={folder}>
        <span className="source-name">📁 {baseName(folder)}</span>
        <span className="muted xs">{info ? `${info.files} files · ${info.chunks} chunks` : '…'}</span>
        <button className="icon-btn sm" title="Remove folder" onClick={() => onSetFolder(null)}>
          ✕
        </button>
      </span>
    )
  }
  return (
    <button className={compact ? 'btn sm ghost' : 'btn sm ghost block'} onClick={pick}>
      📁 Grant a folder
    </button>
  )
}
