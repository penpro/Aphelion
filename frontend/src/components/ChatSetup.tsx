import { useState } from 'react'
import { useStore } from '../store'
import { generateScenePrompt, expandScenePrompt } from '../generators'
import type { Character, Persona, Chat } from '../types'

export function ChatSetup({
  chat,
  character,
  persona,
  onStart,
}: {
  chat: Chat
  character: Character
  persona: Persona
  onStart: () => void
}) {
  const updateChat = useStore((s) => s.updateChat)
  const settings = useStore((s) => s.settings)
  const [busy, setBusy] = useState<'' | 'gen' | 'expand'>('')
  const [err, setErr] = useState('')

  const genPrompt = async () => {
    setBusy('gen')
    setErr('')
    try {
      const t = await generateScenePrompt({ character, persona, settings })
      if (t) updateChat(chat.id, { scenePrompt: t })
    } catch (e) {
      setErr((e as { message?: string })?.message ?? 'Generation failed.')
    } finally {
      setBusy('')
    }
  }

  const expandPrompt = async () => {
    if (!chat.scenePrompt.trim()) return genPrompt()
    setBusy('expand')
    setErr('')
    try {
      const t = await expandScenePrompt({ current: chat.scenePrompt, character, persona, settings })
      if (t) updateChat(chat.id, { scenePrompt: t })
    } catch (e) {
      setErr((e as { message?: string })?.message ?? 'Expand failed.')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="messages">
      <div className="setup-card">
        <div className="setup-title">
          <div className="msg-avatar" style={{ background: character.color }}>
            {character.avatar}
          </div>
          <div>
            <div className="chat-title">New chat with {character.name}</div>
            <div className="muted sm">Set the opening scene, then start.</div>
          </div>
        </div>

        <details className="sub">
          <summary>📖 Read {character.name}</summary>
          <div className="sub-body read">
            {character.description && (
              <p>
                <b>Description.</b> {character.description}
              </p>
            )}
            {character.personality && (
              <p>
                <b>Personality.</b> {character.personality}
              </p>
            )}
            {character.scenario && (
              <p>
                <b>Backdrop.</b> {character.scenario}
              </p>
            )}
          </div>
        </details>

        <details className="sub">
          <summary>🧑 Read persona: {persona.name}</summary>
          <div className="sub-body read">
            <p>{persona.description || '(no description set)'}</p>
          </div>
        </details>

        <label className="field">
          <span>Opening scene — where, when, and what's happening</span>
          <textarea
            value={chat.scenePrompt}
            rows={4}
            placeholder="e.g. Late evening in a rain-soaked market; {{user}} ducks under {{char}}'s awning to escape the downpour."
            onChange={(e) => updateChat(chat.id, { scenePrompt: e.target.value })}
          />
        </label>

        <div className="row gap wrap">
          <button className="btn ghost sm" onClick={expandPrompt} disabled={!!busy}>
            {busy === 'expand' ? 'expanding…' : '✨ Expand prompt'}
          </button>
          <button className="btn ghost sm" onClick={genPrompt} disabled={!!busy}>
            {busy === 'gen' ? 'generating…' : '🎲 Generate prompt'}
          </button>
          <div className="grow" />
          <button className="btn" onClick={onStart} disabled={!!busy}>
            ▶ Start chat
          </button>
        </div>
        {err && <div className="error-line">{err}</div>}
      </div>
    </div>
  )
}
