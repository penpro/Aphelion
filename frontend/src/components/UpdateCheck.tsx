import { useEffect, useState, type CSSProperties } from 'react'
import { invoke } from '@tauri-apps/api/core'

interface UpdateInfo {
  current: string
  latest: string
  updateAvailable: boolean
  url: string
}

type Phase = 'idle' | 'disclose' | 'checking' | 'result'

const boxStyle: CSSProperties = {
  marginTop: 8,
  padding: 10,
  borderRadius: 8,
  background: 'rgba(255,255,255,.04)',
  border: '1px solid rgba(255,255,255,.12)',
  fontSize: 13,
}

/** Manual, disclosed update check. Aphelion is offline by default; this is the only place it
 * reaches the network, and only after the user confirms the disclosure. It reads the latest
 * GitHub release version and links to the download page — it never installs anything itself. */
export function UpdateCheck() {
  const [version, setVersion] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    invoke<string>('app_version')
      .then(setVersion)
      .catch(() => {})
  }, [])

  const check = async () => {
    setErr('')
    setInfo(null)
    setPhase('checking')
    try {
      setInfo(await invoke<UpdateInfo>('check_for_update'))
    } catch (e) {
      setErr(typeof e === 'string' ? e : (e as Error)?.message ?? 'Update check failed.')
    }
    setPhase('result')
  }

  return (
    <div className="field">
      <span>Updates</span>
      <div className="row gap" style={{ alignItems: 'center' }}>
        <span className="muted" style={{ flex: 1, fontSize: 13 }}>
          You're running <b>Aphelion {version || '—'}</b>.
        </span>
        {(phase === 'idle' || phase === 'result') && (
          <button className="btn sm ghost" onClick={() => setPhase('disclose')}>
            Check for updates
          </button>
        )}
      </div>

      {phase === 'disclose' && (
        <div style={boxStyle}>
          <p style={{ margin: '0 0 8px' }}>
            Aphelion runs fully offline. Checking for updates is the one time it reaches the internet — the app (not
            the model) contacts <b>github.com</b> to read the latest release version. Nothing about you, your chats, or
            your files is sent.
          </p>
          <div className="row gap">
            <button className="btn sm" onClick={check}>
              Connect &amp; check
            </button>
            <button className="btn sm ghost" onClick={() => setPhase('idle')}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase === 'checking' && <em className="hint">Contacting GitHub…</em>}

      {phase === 'result' && err && (
        <em className="hint" style={{ color: '#ff6b6b' }}>
          {err}
        </em>
      )}

      {phase === 'result' &&
        info &&
        !err &&
        (info.updateAvailable ? (
          <div style={boxStyle}>
            <p style={{ margin: '0 0 8px' }}>
              <b>Update available:</b> Aphelion {info.latest} (you have {info.current}). Download it from GitHub and run
              the installer.
            </p>
            <button className="btn sm" onClick={() => invoke('open_path', { path: info.url })}>
              View release &amp; download ↗
            </button>
          </div>
        ) : (
          <em className="hint" style={{ color: 'var(--corona, #5EEAD4)' }}>
            ✓ You're on the latest version.
          </em>
        ))}
    </div>
  )
}
