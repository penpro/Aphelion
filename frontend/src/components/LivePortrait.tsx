import { useEffect, useMemo, useRef, useState } from 'react'
import { detectEmotion } from '../emotion'
import { classifyEmotion, classifyPortraitSet, pickPortrait, sceneStateLine } from '../api/classifiers'
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
// With scene tracking on (the default), both modes wait for the chat's carried scene state and
// query THAT — exact outfit colors, pose, mood — instead of sniffing raw prose; `scenePending`
// tells us an update is in flight so the portrait switches exactly once per reply.
// Renders nothing unless live mode is on and the character has portraits to show.
export function LivePortrait({
  chat,
  character,
  enabled,
  streaming,
  scenePending,
  size,
}: {
  chat: Chat
  character: Character
  enabled: boolean
  streaming: boolean
  scenePending?: boolean
  size: 'small' | 'medium' | 'large'
}) {
  const [open, setOpen] = useState(true)
  const [emotion, setEmotion] = useState<EmotionKey>('neutral')
  const baseUrl = useStore((s) => s.settings.baseUrl)
  const updateChat = useStore((s) => s.updateChat)

  // Scene tracking: hold the portrait while the tracker is still working on this reply, and
  // prefer the tracked state (deliberate, colored, carried) over prose once it's fresh.
  const tracking = chat.sceneTracking !== false
  const waiting = tracking && !!scenePending

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

  const last = useMemo(() => {
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      const m = chat.messages[i]
      if (m.role === 'assistant') return { text: m.content, id: m.id }
    }
    return { text: '', id: '' }
  }, [chat.messages])
  const lastText = last.text
  const stateFresh = tracking && !!chat.sceneState && chat.sceneStateFor === last.id

  // Set-mode emotion: once the reply is done (and the scene tracker has answered, when on), show
  // what the character is FEELING. The tracked state answers for free; otherwise one classifier
  // call, holding the current portrait until it lands — one clean switch, heuristic only offline.
  useEffect(() => {
    if (folderMode || streaming || waiting || !lastText) return
    if (stateFresh && chat.sceneState!.emotion) {
      setEmotion(chat.sceneState!.emotion as EmotionKey)
      return
    }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastText, streaming, waiting, stateFresh, chat.sceneState?.emotion, baseUrl, character.id])

  // Auto-switch the active LOOK when the story changes the character's outfit/appearance. With
  // fresh scene state, the query is the exact tracked outfit; otherwise the recent turns.
  useEffect(() => {
    if (folderMode || streaming || waiting || !lastText || !chat.autoPortraitSet) return
    const list = character.portraitSets ?? []
    if (list.length < 2) return
    const activeId = list.find((s) => s.id === chat.portraitSetId)?.id ?? list[0].id
    const recent =
      stateFresh && chat.sceneState!.outfit
        ? `${character.name} is now wearing: ${chat.sceneState!.outfit}.`
        : chat.messages
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
  }, [lastText, streaming, waiting, stateFresh, chat.sceneState?.outfit, baseUrl, chat.id, chat.autoPortraitSet, character.id])

  // Smart-folder pick: one text call chooses the best-matching portrait from the analyzed index.
  // With fresh scene state the query is the carried state line (exact colors and pose); the
  // current portrait holds until the answer lands — one clean switch, failures keep what's showing.
  useEffect(() => {
    if (!folderMode || streaming || waiting || !lastText) return
    const entries = character.portraitIndex ?? []
    const folder = character.portraitFolder!
    const query =
      stateFresh
        ? sceneStateLine(chat.sceneState!)
        : chat.messages
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
            : await pickPortrait(baseUrl, character, entries, pickedFileRef.current ?? undefined, query, ctrl.signal)
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
  }, [lastText, streaming, waiting, stateFresh, chat.sceneState, baseUrl, chat.id, character.id, folderMode])

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
