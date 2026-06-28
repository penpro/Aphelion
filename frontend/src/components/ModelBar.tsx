import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { setKeepAlive, reloadModel, getLoadedModels } from '../api/ollama'
import { cx } from '../util'

export function ModelBar() {
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const { baseUrl, model, keepLoaded } = settings

  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState<'' | 'reload' | 'unload'>('')

  const base = model.split(':')[0]

  // Poll load status.
  useEffect(() => {
    let alive = true
    const tick = async () => {
      const models = await getLoadedModels(baseUrl)
      if (alive) setLoaded(models.length > 0)
    }
    tick()
    const id = setInterval(tick, 6000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [baseUrl, base])

  // Heartbeat: re-pin only while the toggle is *currently* on (read fresh from the
  // store each tick) so a lingering interval can never re-pin after it's turned off.
  useEffect(() => {
    const id = setInterval(() => {
      if (useStore.getState().settings.keepLoaded) setKeepAlive(baseUrl, model, -1)
    }, 120000)
    return () => clearInterval(id)
  }, [baseUrl, model])

  const toggle = async () => {
    const next = !keepLoaded
    updateSettings({ keepLoaded: next })
    // On: pin (-1). Off: revert to normal idle-unload (5m) so it isn't stuck loaded.
    await setKeepAlive(baseUrl, model, next ? -1 : '5m')
    if (next) setLoaded(true)
  }

  const unload = async () => {
    setBusy('unload')
    updateSettings({ keepLoaded: false }) // also un-pin so it stays unloaded
    await setKeepAlive(baseUrl, model, 0)
    setLoaded(false)
    setBusy('')
  }

  const reload = async () => {
    setBusy('reload')
    setLoaded(false)
    await reloadModel(baseUrl, model, keepLoaded ? -1 : '5m')
    setLoaded(true)
    setBusy('')
  }

  return (
    <div className="model-bar">
      <button
        className={cx('keep-toggle', keepLoaded && 'on')}
        onClick={toggle}
        title="Pin the model in VRAM so it doesn't unload between generations (Ollama keep_alive -1). Turn off to let it idle-unload again."
      >
        <span className={cx('dot', loaded ? 'on' : 'off')} />
        {keepLoaded ? 'Model kept loaded' : 'Keep model loaded'}
      </button>
      <div className="model-bar-row">
        <button
          className="btn sm ghost grow"
          onClick={reload}
          disabled={!!busy}
          title="Unload and reload the model fresh — flushes its VRAM/KV context. Your chats are kept."
        >
          {busy === 'reload' ? '…' : '↻ Reload'}
        </button>
        <button
          className="btn sm ghost grow"
          onClick={unload}
          disabled={!!busy || !loaded}
          title="Unload the model now — frees all its VRAM and turns off Keep-loaded. (Your chats are kept; the next generation will cold-load.)"
        >
          {busy === 'unload' ? '…' : '⏏ Unload'}
        </button>
      </div>
    </div>
  )
}
