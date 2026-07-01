import { useEffect, useMemo, useState } from 'react'
import { detectEmotion } from '../emotion'
import { classifyEmotion } from '../api/ollama'
import { useStore } from '../store'
import { portraitSrc } from '../portraits'
import { cx } from '../util'
import type { Character, Chat, EmotionKey } from '../types'

// VN-style "live" stage: a large character portrait above the chat that reads the latest reply's
// emotional tone (pure heuristic — no model call) and shows the matching portrait, with a crossfade.
// Renders nothing unless live mode is on and the character actually has a living portrait set.
export function LivePortrait({
  chat,
  character,
  enabled,
  streaming,
  size,
}: {
  chat: Chat
  character: Character
  enabled: boolean
  streaming: boolean
  size: 'small' | 'medium' | 'large'
}) {
  const [open, setOpen] = useState(true)
  const [emotion, setEmotion] = useState<EmotionKey>('neutral')
  const baseUrl = useStore((s) => s.settings.baseUrl)

  // The active named set for this chat (falls back to the first set, then the legacy single set).
  const set = useMemo(() => {
    const list = character.portraitSets ?? []
    const active = list.find((s) => s.id === chat.portraitSetId) ?? list[0]
    return active?.portraits ?? character.portraits
  }, [character.portraitSets, character.portraits, chat.portraitSetId])

  const lastText = useMemo(() => {
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      if (chat.messages[i].role === 'assistant') return chat.messages[i].content
    }
    return ''
  }, [chat.messages])

  // Read the WHOLE reply once it's done streaming (so the portrait settles on one mood instead of
  // flickering per token). The keyword heuristic gives an instant guess; then we ask the model what
  // THIS character is actually feeling — reading subtext + personality, since a dry or guarded voice
  // isn't anger — and refine to that answer when it arrives. Falls back to the heuristic if offline.
  useEffect(() => {
    if (streaming || !lastText) return
    setEmotion(detectEmotion(lastText)) // instant provisional
    const ctrl = new AbortController()
    let live = true
    classifyEmotion(baseUrl, character, lastText, ctrl.signal)
      .then((e) => {
        if (live && e) setEmotion(e as EmotionKey)
      })
      .catch(() => {})
    return () => {
      live = false
      ctrl.abort()
    }
  }, [lastText, streaming, baseUrl, character.id, character.name, character.personality, character.description])

  if (!enabled || !set || Object.keys(set).length === 0) return null
  const src = set[emotion] ?? set.neutral ?? character.portrait
  if (!src) return null

  return (
    <div className={cx('live-stage', 'lp-' + size, !open && 'is-collapsed')}>
      {open && (
        <div className="live-frame">
          <img key={emotion} src={portraitSrc(src)} alt={`${character.name} — ${emotion}`} className="live-portrait" />
        </div>
      )}
      <button
        type="button"
        className="live-toggle"
        onClick={() => setOpen((o) => !o)}
        title={open ? 'Collapse portrait' : 'Show portrait'}
      >
        <span className="live-emotion">{emotion}</span>
        <span className="live-chevron">{open ? '▾' : '▸'}</span>
      </button>
    </div>
  )
}
