import { useEffect, useState } from 'react'
import { subscribeStorageError, exportData } from '../storage'
import { saveTextFile } from '../tauri'

// Surfaces a persist failure (usually a full localStorage) as a dismissible banner with a one-click
// backup — so "your data didn't save" is loud and actionable instead of silent.
export function StorageBanner() {
  const [message, setMessage] = useState<string | null>(null)
  useEffect(() => subscribeStorageError(setMessage), [])
  if (!message) return null
  return (
    <div className="storage-banner" role="alert">
      <span className="storage-banner-msg">⚠️ {message}</span>
      <button
        className="btn xs"
        onClick={() => saveTextFile('aphelion-backup.json', exportData(), 'application/json')}
      >
        Export backup
      </button>
      <button className="btn xs ghost" onClick={() => setMessage(null)} aria-label="Dismiss">
        ✕
      </button>
    </div>
  )
}
