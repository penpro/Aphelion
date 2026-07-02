import { useEffect, useMemo, useRef, useState } from 'react'
import { detectEmotion } from '../emotion'
import { classifyEmotion, classifyPortraitSet, rankPortraits, sceneStateLine } from '../api/classifiers'
import { useStore } from '../store'
import { portraitSrc } from '../portraits'
import { readImageData } from '../tauri'
import { cx } from '../util'
import type { Character, Chat, EmotionKey, Expression } from '../types'

// VN-style "live" stage: a large character portrait above the chat. Two modes:
// - Smart folder (character has an analyzed portraitFolder): one deterministic text call per
//   finished reply RANKS the best portraits — matching PAD expression axes first (pleasure/
//   energy/dominance — "intense" is not "angry"), then outfit+setting, details, pose dead last.
//   The WHY tab slides out the inspector: driving tags, 👍/👎 training, tag demote/add, and
//   cycling through the ranked alternates. Feedback re-weights tags via Character.tagBias
//   (see PORTRAIT-ENGINE.md) — the LLM keeps judging; the user re-weights its evidence.
// - Portrait sets: the model classifies what the character is FEELING (subtext, not prose tone)
//   and shows that emotion slot; with auto-switch on, the active set follows outfit changes.
// With scene tracking on (the default), both modes wait for the chat's carried scene state and
// query THAT — exact outfit colors, pose, mood — instead of sniffing raw prose; `scenePending`
// tells us an update is in flight so the portrait switches exactly once per reply.
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
  const updateCharacter = useStore((s) => s.updateCharacter)

  // Scene tracking: hold the portrait while the tracker is still working on this reply, and
  // prefer the tracked state (deliberate, colored, carried) over prose once it's fresh.
  const tracking = chat.sceneTracking !== false
  const waiting = tracking && !!scenePending

  // Smart-folder mode: an analyzed portrait folder overrides set/emotion mode entirely.
  const folderMode = !!(character.portraitFolder && (character.portraitIndex?.length ?? 0) > 0)
  const [picked, setPicked] = useState<{ file: string; src: string; tags: string; drivers: string[] } | null>(null)
  const [alts, setAlts] = useState<string[]>([]) // the ranked list; [0] is the model's top pick
  const [altIdx, setAltIdx] = useState(0)
  const [inspect, setInspect] = useState(false)
  const [newTag, setNewTag] = useState('')
  const [fb, setFb] = useState<'up' | 'down' | null>(null) // brief visual ack on feedback
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

  const showFile = async (file: string, drivers: string[]) => {
    let src = imgCache.current.get(file)
    if (!src) {
      src = await readImageData(character.portraitFolder!, file)
      imgCache.current.set(file, src)
    }
    if (!src) return
    pickedFileRef.current = file
    const tags = character.portraitIndex?.find((e) => e.file === file)?.tags ?? ''
    setPicked({ file, src, tags, drivers })
  }

  // User-trained tag bias → the AVOID/FAVOR guidance in the ranking prompt (PORTRAIT-ENGINE.md).
  const biasLists = () => {
    const b = character.tagBias ?? {}
    const entries = Object.entries(b)
    const avoid = entries.filter(([, v]) => v <= -30).sort((x, y) => x[1] - y[1]).slice(0, 8).map(([k]) => k)
    const favor = entries.filter(([, v]) => v >= 30).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k]) => k)
    return avoid.length || favor.length ? { avoid, favor } : undefined
  }

  // Smart-folder ranking: one text call per finished reply ranks the top portraits from the
  // analyzed index (PAD axes first, then outfit+setting, details, pose). The current portrait
  // holds until the answer lands — one clean switch; failures keep what's showing.
  useEffect(() => {
    if (!folderMode || streaming || waiting || !lastText) return
    const entries = character.portraitIndex ?? []
    const query =
      stateFresh
        ? sceneStateLine(chat.sceneState!)
        : chat.messages
            .slice(-6)
            .map((m) => `${m.role === 'user' ? 'User' : character.name}: ${m.content}`)
            .join('\n\n')
    const moment: Expression | undefined = stateFresh ? chat.expression : undefined
    const ctrl = new AbortController()
    let live = true
    const run = async () => {
      try {
        if (entries.length === 1) {
          if (live) await showFile(entries[0].file, [])
          setAlts([entries[0].file])
          setAltIdx(0)
          return
        }
        const rank = await rankPortraits(baseUrl, character, entries, pickedFileRef.current ?? undefined, query, moment, biasLists(), ctrl.signal)
        if (!rank || !live) return
        setAlts(rank.files)
        setAltIdx(0)
        await showFile(rank.files[0], rank.drivers)
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
  }, [lastText, streaming, waiting, stateFresh, chat.sceneState, chat.expression, baseUrl, chat.id, character.id, folderMode])

  // ---- Trainability: feedback re-weights the tags that drove the pick (PORTRAIT-ENGINE.md) ----
  const adjustBias = (tags: string[], delta: number) => {
    const clean = tags.map((t) => t.trim().toLowerCase()).filter(Boolean)
    if (!clean.length) return
    const bias = { ...(character.tagBias ?? {}) }
    for (const t of clean) bias[t] = Math.max(-100, Math.min(100, (bias[t] ?? 0) + delta))
    updateCharacter(character.id, { tagBias: bias })
  }
  const flash = (kind: 'up' | 'down') => {
    setFb(kind)
    setTimeout(() => setFb(null), 700)
  }
  const thumbsUp = () => {
    adjustBias(picked?.drivers ?? [], +10)
    flash('up')
  }
  const thumbsDown = async () => {
    adjustBias(picked?.drivers ?? [], -15)
    flash('down')
    if (alts.length > 1) await cycle(1) // a bad pick immediately tries the next-ranked portrait
  }
  const demoteTag = (t: string) => adjustBias([t], -25)
  const addUserTag = () => {
    const t = newTag.trim().toLowerCase()
    if (!t || !picked) return
    const idx = (character.portraitIndex ?? []).map((e) =>
      e.file === picked.file && !e.tags.toLowerCase().includes(t) ? { ...e, tags: `${e.tags}, ${t}` } : e,
    )
    updateCharacter(character.id, { portraitIndex: idx })
    setPicked({ ...picked, tags: idx.find((e) => e.file === picked.file)?.tags ?? picked.tags })
    setNewTag('')
  }
  const cycle = async (dir: 1 | -1) => {
    if (alts.length < 2 || !picked) return
    const i = (altIdx + dir + alts.length) % alts.length
    setAltIdx(i)
    await showFile(alts[i], picked.drivers)
  }

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

  const entry = folderMode && picked ? character.portraitIndex?.find((e) => e.file === picked.file) : undefined
  const bias = character.tagBias ?? {}
  const axes = (x?: Expression) => (x ? `P${x.pleasure} E${x.energy} D${x.dominance}` : '—')

  return (
    <div className={cx('live-stage', 'lp-' + size, !open && 'is-collapsed')}>
      {open && (
        <div className="live-wrap">
          <div className="live-frame">
            <img key={display.key} src={display.src} alt={`${character.name} — ${display.label}`} className="live-portrait" />
            {folderMode && picked && (
              <button
                type="button"
                className={cx('lp-why', inspect && 'on')}
                title="Why this portrait? Inspect and train the picker"
                aria-expanded={inspect}
                onClick={() => setInspect((v) => !v)}
              >
                WHY
              </button>
            )}
          </div>
          {folderMode && picked && inspect && (
            <div className="lp-inspector">
              <div className="lp-insp-file" title={picked.file}>{picked.file}</div>

              <div className="lp-insp-sec">
                <span className="lp-insp-k">Picked for</span>
                <div className="lp-chips">
                  {picked.drivers.length ? (
                    picked.drivers.map((t) => (
                      <button
                        key={t}
                        type="button"
                        className={cx('lp-chip', 'driver', (bias[t] ?? 0) <= -30 && 'cooled')}
                        title={`Demote “${t}” (−25) · bias ${bias[t] ?? 0}`}
                        onClick={() => demoteTag(t)}
                      >
                        {t}
                      </button>
                    ))
                  ) : (
                    <span className="muted xs">—</span>
                  )}
                </div>
              </div>

              <div className="lp-insp-sec lp-fb">
                <button type="button" className={cx('btn xs ghost', fb === 'up' && 'fb-on')} title="Good pick — warm these tags (+10)" onClick={thumbsUp}>
                  👍
                </button>
                <button type="button" className={cx('btn xs ghost', fb === 'down' && 'fb-on')} title="Bad pick — cool these tags (−15) and try the next-ranked portrait" onClick={thumbsDown}>
                  👎
                </button>
                {alts.length > 1 && (
                  <span className="lp-cycle">
                    <button type="button" className="btn xs ghost" title="Previous ranked portrait" onClick={() => cycle(-1)}>◂</button>
                    <span className="muted xs">{altIdx + 1}/{alts.length}</span>
                    <button type="button" className="btn xs ghost" title="Next ranked portrait" onClick={() => cycle(1)}>▸</button>
                  </span>
                )}
              </div>

              <div className="lp-insp-sec">
                <span className="lp-insp-k">Expression · now {axes(chat.expression)} · art {axes(entry?.expression)}</span>
              </div>

              <div className="lp-insp-sec">
                <span className="lp-insp-k">All tags — click to demote</span>
                <div className="lp-chips">
                  {picked.tags.split(',').map((raw) => {
                    const t = raw.trim()
                    if (!t) return null
                    return (
                      <button
                        key={t}
                        type="button"
                        className={cx('lp-chip', (bias[t.toLowerCase()] ?? 0) <= -30 && 'cooled')}
                        title={`Demote “${t}” (−25) · bias ${bias[t.toLowerCase()] ?? 0}`}
                        onClick={() => demoteTag(t)}
                      >
                        {t}
                      </button>
                    )
                  })}
                </div>
                <div className="lp-addtag">
                  <input
                    value={newTag}
                    placeholder="add a tag…"
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addUserTag()}
                  />
                  <button type="button" className="btn xs ghost" onClick={addUserTag} disabled={!newTag.trim()}>
                    ＋
                  </button>
                </div>
              </div>
            </div>
          )}
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
