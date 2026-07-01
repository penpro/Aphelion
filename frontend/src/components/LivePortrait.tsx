import { useEffect, useMemo, useState } from 'react'
import { detectEmotion } from '../emotion'
import { classifyEmotion, classifyPortraitSet } from '../api/ollama'
import { useStore } from '../store'
import { portraitSrc } from '../portraits'
import { cx } from '../util'
import type { Character, Chat, EmotionKey } from '../types'

// VN-style "live" stage: a large character portrait above the chat. It asks the model what the
// character is feeling on each finished reply and shows the matching portrait (crossfaded), and —
// with auto-switch on — matches the scene to a portrait set so outfits change with the story.
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
  const updateChat = useStore((s) => s.updateChat)

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
  // flickering per token). We ask the model what THIS character is actually feeling — reading subtext
  // + personality, since a dry or guarded voice isn't anger. The current portrait is held until that
  // answer lands, so we switch exactly ONCE (no heuristic→model double-flick); the keyword heuristic
  // is only the fallback when the engine is unreachable.
  useEffect(() => {
    if (streaming || !lastText) return
    const ctrl = new AbortController()
    let live = true
    classifyEmotion(baseUrl, character, lastText, ctrl.signal)
      .then((e) => {
        if (live) setEmotion((e as EmotionKey) ?? detectEmotion(lastText))
      })
      .catch(() => {
        if (live) setEmotion(detectEmotion(lastText))
      })
    return () => {
      live = false
      ctrl.abort()
    }
  }, [lastText, streaming, baseUrl, character.id, character.name, character.personality, character.description])

  // Auto-switch the active LOOK when the story changes the character's outfit/appearance. Runs once
  // per finished reply (only with auto on + 2+ sets); reads the recent turns, matches them to each
  // set's description, and updates the chat's active set if it clearly changed. Sticky by design.
  useEffect(() => {
    if (streaming || !lastText || !chat.autoPortraitSet) return
    const list = character.portraitSets ?? []
    if (list.length < 2) return
    const activeId = list.find((s) => s.id === chat.portraitSetId)?.id ?? list[0].id
    const recent = chat.messages
      .slice(-6)
      .map((m) => `${m.role === 'user' ? 'User' : character.name}: ${m.content}`)
      .join('\n\n')
    const ctrl = new AbortController()
    let live = true
    classifyPortraitSet(baseUrl, character, list, activeId, recent, ctrl.signal)
      .then((id) => {
        if (live && id && id !== activeId) updateChat(chat.id, { portraitSetId: id })
      })
      .catch(() => {})
    return () => {
      live = false
      ctrl.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastText, streaming, baseUrl, chat.id, chat.autoPortraitSet, character.id])

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
