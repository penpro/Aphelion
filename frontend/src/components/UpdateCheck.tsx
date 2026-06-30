import { useEffect, useState, type CSSProperties } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'

type Phase = 'idle' | 'disclose' | 'checking' | 'none' | 'available' | 'installing' | 'error'

const boxStyle: CSSProperties = {
  marginTop: 8,
  padding: 10,
  borderRadius: 8,
  background: 'rgba(255,255,255,.04)',
  border: '1px solid rgba(255,255,255,.12)',
  fontSize: 13,
}

/** Manual, disclosed updater. Aphelion is offline by default; only on the user's click (after the
 * disclosure) does it contact GitHub. If a newer signed release exists it downloads + installs it
 * in-app with a progress bar and relaunches — no browser, no installer prompts. */
export function UpdateCheck() {
  const [version, setVersion] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [update, setUpdate] = useState<Update | null>(null)
  const [err, setErr] = useState('')
  const [pct, setPct] = useState(0)

  useEffect(() => {
    invoke<string>('app_version')
      .then(setVersion)
      .catch(() => {})
  }, [])

  const doCheck = async () => {
    setErr('')
    setPhase('checking')
    try {
      const u = await check()
      if (u) {
        setUpdate(u)
        setPhase('available')
      } else {
        setPhase('none')
      }
    } catch (e) {
      setErr(typeof e === 'string' ? e : (e as Error)?.message ?? 'Update check failed.')
      setPhase('error')
    }
  }

  const install = async () => {
    if (!update) return
    setErr('')
    setPhase('installing')
    setPct(0)
    try {
      let total = 0
      let got = 0
      await update.downloadAndInstall((ev) => {
        if (ev.event === 'Started') {
          total = ev.data.contentLength ?? 0
        } else if (ev.event === 'Progress') {
          got += ev.data.chunkLength
          if (total > 0) setPct(Math.round((got / total) * 100))
        }
      })
      await relaunch()
    } catch (e) {
      setErr(typeof e === 'string' ? e : (e as Error)?.message ?? 'Update failed to install.')
      setPhase('error')
    }
  }

  return (
    <div className="field">
      <span>Updates</span>
      <div className="row gap" style={{ alignItems: 'center' }}>
        <span className="muted" style={{ flex: 1, fontSize: 13 }}>
          You're running <b>Aphelion {version || '—'}</b>.
        </span>
        {(phase === 'idle' || phase === 'none' || phase === 'error') && (
          <button className="btn sm ghost" onClick={() => setPhase('disclose')}>
            Check for updates
          </button>
        )}
      </div>

      {phase === 'disclose' && (
        <div style={boxStyle}>
          <p style={{ margin: '0 0 8px' }}>
            Aphelion runs fully offline. Checking for updates is the one time it reaches the internet — the app (not the
            model) contacts <b>github.com</b> to look for a newer release and, if you choose, download it. Nothing about
            you, your chats, or your files is sent.
          </p>
          <div className="row gap">
            <button className="btn sm" onClick={doCheck}>
              Connect &amp; check
            </button>
            <button className="btn sm ghost" onClick={() => setPhase('idle')}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {phase === 'checking' && <em className="hint">Contacting GitHub…</em>}

      {phase === 'none' && (
        <em className="hint" style={{ color: 'var(--corona, #5EEAD4)' }}>
          ✓ You're on the latest version.
        </em>
      )}

      {phase === 'error' && err && (
        <em className="hint" style={{ color: '#ff6b6b' }}>
          {err}
        </em>
      )}

      {phase === 'available' && update && (
        <div style={boxStyle}>
          <p style={{ margin: '0 0 8px' }}>
            <b>Update available:</b> Aphelion {update.version} (you have {update.currentVersion}). It downloads and
            installs here, then relaunches — no browser or installer steps.
          </p>
          <div className="row gap">
            <button className="btn sm" onClick={install}>
              ⬇ Download &amp; install
            </button>
            <button
              className="btn sm ghost"
              onClick={() => {
                setUpdate(null)
                setPhase('idle')
              }}
            >
              Not now
            </button>
          </div>
        </div>
      )}

      {phase === 'installing' && (
        <div style={boxStyle}>
          <p style={{ margin: '0 0 8px' }}>
            Downloading &amp; installing{pct > 0 ? ` — ${pct}%` : '…'}. The app will relaunch when it's done.
          </p>
          <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,.1)', overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: 'var(--corona, #5EEAD4)', transition: 'width .3s' }} />
          </div>
        </div>
      )}
    </div>
  )
}
