import { useEffect, useMemo, useRef, useState } from 'react'
import { detectEmotion } from '../emotion'
import { classifyEmotion, classifyPortraitSet, pickPortrait } from '../api/ollama'
import { useStore } from '../store'
import { portraitSrc } from '../portraits'
import { readImageData } from '../tauri'
import { cx } from '../util'
import type { Character, Chat, EmotionKey } from '../types'

// VN-style "live" stage: a large character portrait above the chat. Two modes:
// - Smart folder (character has an analyzed portraitFolder): one deterministic text call per
//   finished reply picks the best portrait — emotion, outfit, and pose in one shot — from the
//   vision-built keyword index. No vision model at runtime; images load once and are cached.
// - Portrait sets: the model classifies what the character is FEELING (subtext, not prose tone)
//   and shows that emotion slot; with auto-switch on, the active set follows outfit changes.
// Renders nothing unless live mode is on and the character has portraits to show.
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

  // Smart-folder mode: an analyzed portrait folder overrides set/emotion mode entirely.
  const folderMode = !!(character.portraitFolder && (character.portraitIndex?.length ?? 0) > 0)
  const [picked, setPicked] = useState<{ file: string; src: string; tags: string } | null>(null)
  const pickedFileRef = useRef<string | null>(null) // current file for the sticky prompt, without retriggering the effect
  const imgCache = useRef(new Map<string, string>()) // file -> data URL, so each image is read from disk once

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
    if (folderMode || streaming || !lastText) return
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
    if (folderMode || streaming || !lastText || !chat.autoPortraitSet) return
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

  // Smart-folder pick: after each finished reply, one text call chooses the best-matching portrait
  // from the analyzed index (sticky on outfit, expressive on emotion). The current portrait holds
  // until the answer lands — one clean switch, and a failed call keeps what's showing.
  useEffect(() => {
    if (!folderMode || streaming || !lastText) return
    const entries = character.portraitIndex ?? []
    const folder = character.portraitFolder!
    const recent = chat.messages
      .slice(-6)
      .map((m) => `${m.role === 'user' ? 'User' : character.name}: ${m.content}`)
      .join('\n\n')
    const ctrl = new AbortController()
    let live = true
    const run = async () => {
      try {
        const file =
          entries.length === 1
            ? entries[0].file
            : await pickPortrait(baseUrl, character, entries, pickedFileRef.current ?? undefined, recent, ctrl.signal)
        if (!file || !live) return
        let src = imgCache.current.get(file)
        if (!src) {
          src = await readImageData(folder, file)
          imgCache.current.set(file, src)
        }
        if (live && src) {
          pickedFileRef.current = file
          setPicked({ file, src, tags: entries.find((e) => e.file === file)?.tags ?? '' })
        }
      } catch {
        /* keep the current portrait */
      }
    }
    run()
    return () => {
      live = false
      ctrl.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastText, streaming, baseUrl, chat.id, character.id, folderMode])

  if (!enabled) return null
  if (!folderMode && (!set || Object.keys(set).length === 0)) return null
  // Folder mode shows the picked portrait (falling back to the set/base portrait before the first
  // pick lands); set mode shows the classified emotion slot.
  const setSrc = set && Object.keys(set).length ? (set[emotion] ?? set.neutral ?? character.portrait) : character.portrait
  const display =
    folderMode && picked
      ? { key: picked.file, src: picked.src, label: picked.tags.split(',').slice(0, 2).join(',').trim() || 'auto' }
      : setSrc
        ? { key: emotion, src: portraitSrc(setSrc)!, label: emotion }
        : null
  if (!display) return null

  return (
    <div className={cx('live-stage', 'lp-' + size, !open && 'is-collapsed')}>
      {open && (
        <div className="live-frame">
          <img key={display.key} src={display.src} alt={`${character.name} — ${display.label}`} className="live-portrait" />
        </div>
      )}
      <button
        type="button"
        className="live-toggle"
        onClick={() => setOpen((o) => !o)}
        title={open ? 'Collapse portrait' : 'Show portrait'}
      >
        <span className="live-emotion">{display.label}</span>
        <span className="live-chevron">{open ? '▾' : '▸'}</span>
      </button>
    </div>
  )
}
