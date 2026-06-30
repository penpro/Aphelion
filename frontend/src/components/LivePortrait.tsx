import { useEffect, useMemo, useState } from 'react'
import { detectEmotion } from '../emotion'
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
  const set = character.portraits

  const lastText = useMemo(() => {
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      if (chat.messages[i].role === 'assistant') return chat.messages[i].content
    }
    return ''
  }, [chat.messages])

  // Take the tone of the WHOLE reply: only re-read once it's done streaming, so the portrait
  // settles on one mood for the response instead of flipping word-by-word as tokens arrive.
  useEffect(() => {
    if (streaming) return
    setEmotion(detectEmotion(lastText))
  }, [lastText, streaming])

  if (!enabled || !set || Object.keys(set).length === 0) return null
  const src = set[emotion] ?? set.neutral ?? character.portrait
  if (!src) return null

  return (
    <div className={cx('live-stage', 'lp-' + size, !open && 'is-collapsed')}>
      {open && (
        <div className="live-frame">
          <img key={emotion} src={src} alt={`${character.name} — ${emotion}`} className="live-portrait" />
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
