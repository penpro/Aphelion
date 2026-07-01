import { useMemo, useRef, useState, type ReactNode, type PointerEvent } from 'react'
import { useStore } from '../store'
import { useConfirm } from './ConfirmDialog'
import { generateStory, parseScreenplay } from '../generators'
import { SourcesPanel } from './SourcesPanel'
import { DEFAULT_DIALS, defaultFlowCurve } from '../seed'
import { download, cx } from '../util'
import type { Character, StoryBeat, StoryDials, POV } from '../types'

const LENGTHS = [
  { label: 'Scene', words: 800 },
  { label: 'Short', words: 1800 },
  { label: 'Long', words: 3600 },
  { label: 'Epic', words: 6000 },
]
const PER_PASS = 1500 // words generated per continuation pass
const countWords = (s: string): number => s.trim().match(/\S+/g)?.length ?? 0
const pages = (w: number): number => Math.max(1, Math.round(w / 600))
const TONES = ['Romantic', 'Tense', 'Dark', 'Comedic', 'Whimsical', 'Gritty', 'Melancholic', 'Hopeful', 'Epic', 'Cozy', 'Mysterious', 'Sensual', 'Bittersweet']
const SETTINGS = ['Medieval fantasy', 'Modern city', 'Space station', 'Victorian London', 'Post-apocalyptic', 'Cyberpunk', 'Small town', 'Royal court', 'High seas', 'Wild West']
const GENRES = ['Romance', 'Adventure', 'Mystery', 'Horror', 'Drama', 'Comedy', 'Thriller', 'Slice of life', 'Fantasy', 'Sci-fi']
const POVS: { id: POV; label: string }[] = [
  { id: '1st', label: '1st · "I"' },
  { id: '2nd', label: '2nd · "you"' },
  { id: '3rd', label: '3rd' },
]
const INTENSITY = ['', 'Wholesome', 'Mild', 'Suggestive', 'Steamy', 'Explicit']
const FLOW_PRESETS: { name: string; curve: number[] }[] = [
  { name: 'Flat', curve: Array(10).fill(50) },
  { name: 'Build', curve: [30, 35, 40, 45, 50, 55, 65, 72, 80, 85] },
  { name: 'Wave', curve: [40, 62, 40, 62, 40, 62, 40, 62, 40, 62] },
  { name: 'Dialogue', curve: Array(10).fill(28) },
  { name: 'Description', curve: Array(10).fill(72) },
]

function slug(s: string): string {
  return s.replace(/[^\w-]+/g, '_').slice(0, 60) || 'story'
}

function inline(text: string): ReactNode[] {
  return text.split(/(\*[^*]+\*)/g).map((p, i) =>
    p.length > 1 && p.startsWith('*') && p.endsWith('*') ? <em key={i}>{p.slice(1, -1)}</em> : <span key={i}>{p}</span>,
  )
}

function beatsToText(beats: { type: string; speaker: string; text: string }[]): string {
  return beats.map((b) => (b.type === 'narration' ? b.text : `${b.speaker}: ${b.text}`)).join('\n\n')
}

function FlowEq({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const setAt = (i: number, raw: number) => {
    const v = [...value]
    v[i] = Math.max(0, Math.min(100, Math.round(raw)))
    onChange(v)
  }
  const fromEvent = (i: number, e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    setAt(i, 100 - ((e.clientY - r.top) / r.height) * 100)
  }
  return (
    <div className="eq">
      {value.map((v, i) => (
        <div
          key={i}
          className="eq-col"
          title={`Segment ${i + 1}: ${v >= 58 ? 'description' : v >= 42 ? 'balanced' : 'dialogue'} (${v})`}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId)
            fromEvent(i, e)
          }}
          onPointerMove={(e) => {
            if (e.buttons === 1) fromEvent(i, e)
          }}
        >
          <div className="eq-fill" style={{ height: `${v}%` }} />
          <span className="eq-num">{i + 1}</span>
        </div>
      ))}
    </div>
  )
}

export function StoryView() {
  const stories = useStore((s) => s.stories)
  const characters = useStore((s) => s.characters)
  const activeStoryId = useStore((s) => s.activeStoryId)
  const settings = useStore((s) => s.settings)
  const createStory = useStore((s) => s.createStory)
  const updateStory = useStore((s) => s.updateStory)
  const storeUpdateDials = useStore((s) => s.updateDials)
  const deleteStory = useStore((s) => s.deleteStory)
  const setBeats = useStore((s) => s.setBeats)
  const confirm = useConfirm()

  const [busy, setBusy] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [reasoningText, setReasoningText] = useState('')
  const [progress, setProgress] = useState<{ words: number; target: number } | null>(null)
  const [error, setError] = useState('')
  const abortRef = useRef<AbortController | null>(null)

  const story = useMemo(() => stories.find((s) => s.id === activeStoryId) ?? null, [stories, activeStoryId])
  const colorFor = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of characters) map.set(c.name.toLowerCase(), c.color)
    return (speaker: string) => map.get(speaker.toLowerCase()) ?? '#9aa3b6'
  }, [characters])

  if (!story) {
    return (
      <div className="chat empty-state">
        <div>
          <h1>🎬 Story Mode</h1>
          <p className="muted">Pick a cast, set the direction, and the characters write the whole scene in one pass.</p>
          <button className="btn" onClick={() => createStory({ title: 'Untitled story', premise: '', characterIds: [], targetBeats: 12 })}>
            + New story
          </button>
        </div>
      </div>
    )
  }

  const dials: StoryDials = story.dials ?? DEFAULT_DIALS
  const steerLines: string[] = story.steerLines ?? []
  const flowCurve: number[] = story.flowCurve?.length === 10 ? story.flowCurve : defaultFlowCurve()
  const cast = story.characterIds.map((id) => characters.find((c) => c.id === id)).filter(Boolean) as Character[]

  const updateDials = (patch: Partial<StoryDials>) => storeUpdateDials(story.id, patch)
  const toggleTone = (t: string) =>
    updateDials({ tone: dials.tone.includes(t) ? dials.tone.filter((x) => x !== t) : [...dials.tone, t] })
  const toggleCast = (id: string) => {
    const has = story.characterIds.includes(id)
    updateStory(story.id, { characterIds: has ? story.characterIds.filter((x) => x !== id) : [...story.characterIds, id] })
  }
  const setSteer = (i: number, v: string) => {
    const s = [...steerLines]
    s[i] = v
    updateStory(story.id, { steerLines: s })
  }

  const run = async (extend: boolean) => {
    setError('')
    const fresh = useStore.getState().stories.find((s) => s.id === story.id)
    if (!fresh) return
    const liveCast = fresh.characterIds.map((id) => characters.find((c) => c.id === id)).filter(Boolean) as Character[]
    if (liveCast.length < 1) return setError('Pick at least one character for the cast.')
    if (!fresh.premise.trim() && !fresh.dials.setting.trim()) return setError('Give a seed idea or at least a setting.')

    const castNames = liveCast.map((c) => c.name)
    const commit = (text: string) => {
      const parsed = parseScreenplay(text, castNames)
      setBeats(
        story.id,
        parsed.map((p) => {
          const m = liveCast.find((c) => c.name.toLowerCase() === p.speaker.toLowerCase())
          return { characterId: m?.id ?? null, speaker: m?.name ?? p.speaker, type: p.type, text: p.text }
        }),
      )
    }

    const ctrl = new AbortController()
    abortRef.current = ctrl
    setBusy(true)
    setReasoningText('')

    let acc = extend ? beatsToText(fresh.beats) : ''
    const goal = (extend ? countWords(acc) : 0) + fresh.targetWords
    setStreamText(acc)
    const maxPasses = Math.min(12, Math.ceil(fresh.targetWords / 1000) + 3)

    try {
      for (let pass = 0; pass < maxPasses; pass++) {
        if (ctrl.signal.aborted) break
        const have = countWords(acc)
        const remaining = goal - have
        if (remaining <= 80) break
        const chunk = Math.max(500, Math.min(PER_PASS, remaining))
        const conclude = remaining <= PER_PASS && !extend
        const base = acc
        setReasoningText('')
        setProgress({ words: have, target: goal })
        const passText = await generateStory({
          cast: liveCast,
          premise: fresh.premise,
          targetWords: fresh.targetWords,
          chunkWords: chunk,
          conclude,
          dials: fresh.dials,
          steerLines: fresh.steerLines,
          flowCurve: fresh.flowCurve,
          sources: fresh.sources,
          previous: base || undefined,
          settings,
          signal: ctrl.signal,
          onReasoning: (d) => setReasoningText((t) => t + d),
          onContent: (d) => setStreamText((t) => t + d),
        })
        acc = base ? `${base}\n\n${passText.trim()}` : passText.trim()
        setStreamText(acc)
        setProgress({ words: countWords(acc), target: goal })
        commit(acc) // keep the store in sync after each pass
        if (countWords(passText) < 40) break // model stalled
        if (conclude) break
      }
    } catch (e) {
      const err = e as { name?: string; message?: string }
      if (err?.name !== 'AbortError') setError(err?.message ?? 'Generation failed.')
    } finally {
      if (acc.trim()) commit(acc) // keep whatever streamed (incl. on Stop)
      setBusy(false)
      setStreamText('')
      setProgress(null)
      abortRef.current = null
    }
  }

  const exportJSON = () => {
    const data = {
      format: 'localllm-story@1',
      title: story.title,
      premise: story.premise,
      direction: dials,
      characters: cast.map((c) => ({ id: c.id, name: c.name, description: c.description })),
      beats: story.beats.map((b, i) => ({ index: i, speaker: b.speaker, characterId: b.characterId, type: b.type, text: b.text })),
    }
    download(`${slug(story.title)}.story.json`, JSON.stringify(data, null, 2), 'application/json')
  }
  const exportMarkdown = () => {
    const lines = [`# ${story.title}`, '', `> ${story.premise}`, '']
    for (const b of story.beats) lines.push(b.type === 'narration' ? `*${b.text}*` : `**${b.speaker}:** ${b.text}`, '')
    download(`${slug(story.title)}.md`, lines.join('\n'), 'text/markdown')
  }

  const liveBeats = busy && streamText ? parseScreenplay(streamText, cast.map((c) => c.name)) : null

  return (
    <div className="chat">
      <header className="chat-head">
        <input className="title-input" value={story.title} onChange={(e) => updateStory(story.id, { title: e.target.value })} />
        <div className="row gap">
          <button className="btn sm ghost" onClick={exportJSON} disabled={!story.beats.length}>
            Export JSON
          </button>
          <button className="btn sm ghost" onClick={exportMarkdown} disabled={!story.beats.length}>
            Export .md
          </button>
          <button className="btn sm ghost danger" onClick={async () => { if (await confirm({ title: 'Delete story?', message: 'This story and all of its beats will be permanently deleted.', confirmLabel: 'Delete' })) deleteStory(story.id) }}>
            Delete
          </button>
        </div>
      </header>

      <div className="messages">
        <div className="setup-card">
          <div className="field">
            <span>Cast — click to add/remove</span>
            <div className="chips">
              {characters.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={cx('chip', story.characterIds.includes(c.id) && 'sel')}
                  style={story.characterIds.includes(c.id) ? { borderColor: c.color } : undefined}
                  onClick={() => toggleCast(c.id)}
                >
                  <span>{c.avatar}</span> {c.name}
                </button>
              ))}
              {characters.length === 0 && <span className="muted sm">Create a character first (Chat tab).</span>}
            </div>
          </div>

          <label className="field">
            <span>Seed idea — a one-liner; the model fills in the when, where & flavor</span>
            <textarea
              value={story.premise}
              rows={2}
              placeholder="e.g. they meet and end up falling in love"
              onChange={(e) => updateStory(story.id, { premise: e.target.value })}
            />
          </label>

          <details className="sub" open>
            <summary>🎚 Direction</summary>
            <div className="sub-body">
              <label className="field">
                <span>Setting</span>
                <input value={dials.setting} placeholder="when & where (or leave blank to let it invent one)" onChange={(e) => updateDials({ setting: e.target.value })} />
                <div className="chips tight">
                  {SETTINGS.map((s) => (
                    <button key={s} type="button" className="chip xs" onClick={() => updateDials({ setting: s })}>
                      {s}
                    </button>
                  ))}
                </div>
              </label>

              <div className="field">
                <span>Tone (any number)</span>
                <div className="chips">
                  {TONES.map((t) => (
                    <button key={t} type="button" className={cx('chip', dials.tone.includes(t) && 'sel')} onClick={() => toggleTone(t)}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <label className="field">
                <span>Genre</span>
                <input value={dials.genre} placeholder="optional" onChange={(e) => updateDials({ genre: e.target.value })} />
                <div className="chips tight">
                  {GENRES.map((g) => (
                    <button key={g} type="button" className="chip xs" onClick={() => updateDials({ genre: g })}>
                      {g}
                    </button>
                  ))}
                </div>
              </label>

              <div className="row gap wrap">
                <div className="field">
                  <span>Point of view</span>
                  <div className="seg">
                    {POVS.map((p) => (
                      <button key={p.id} type="button" className={cx('seg-btn', dials.pov === p.id && 'sel')} onClick={() => updateDials({ pov: p.id })}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="field grow">
                  <span>Pace — {['very slow', 'slow-burn', 'steady', 'brisk', 'fast'][Math.min(4, Math.floor(dials.pacing / 25))]}</span>
                  <input type="range" min={0} max={100} step={5} value={dials.pacing} onChange={(e) => updateDials({ pacing: Number(e.target.value) })} />
                </label>
                <label className="field grow">
                  <span>Intensity — {INTENSITY[dials.intensity]}</span>
                  <input type="range" min={1} max={5} step={1} value={dials.intensity} onChange={(e) => updateDials({ intensity: Number(e.target.value) })} />
                </label>
              </div>

              <label className="field">
                <span>Ending (optional)</span>
                <input value={dials.ending} placeholder="e.g. ends on a cliffhanger / a first kiss / a betrayal revealed" onChange={(e) => updateDials({ ending: e.target.value })} />
              </label>
            </div>
          </details>

          <details className="sub">
            <summary>✍️ Steer lines — one-liners to push the story toward ({steerLines.filter((s) => s.trim()).length})</summary>
            <div className="sub-body">
              <p className="muted xs">Touchstones, not script. The model matches their flavor and builds toward such beats — it won't copy them.</p>
              {steerLines.map((line, i) => (
                <div key={i} className="row gap">
                  <input
                    value={line}
                    placeholder={"e.g. He pulled her in for a rough kiss she wasn't ready for but didn't quite hate."}
                    onChange={(e) => setSteer(i, e.target.value)}
                  />
                  <button className="icon-btn" title="Remove" onClick={() => updateStory(story.id, { steerLines: steerLines.filter((_, j) => j !== i) })}>
                    🗑
                  </button>
                </div>
              ))}
              <button className="btn sm ghost" onClick={() => updateStory(story.id, { steerLines: [...steerLines, ''] })}>
                + Add steer line
              </button>
            </div>
          </details>

          <details className="sub">
            <summary>🎛 Flow — dialogue ↔ description across the scene</summary>
            <div className="sub-body">
              <p className="muted xs">Bar height = more description; low = more dialogue. Drag the bars to shape the rhythm across 10 segments.</p>
              <FlowEq value={flowCurve} onChange={(v) => updateStory(story.id, { flowCurve: v })} />
              <div className="chips tight">
                {FLOW_PRESETS.map((p) => (
                  <button key={p.name} type="button" className="chip xs" onClick={() => updateStory(story.id, { flowCurve: [...p.curve] })}>
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          </details>

          <details className="sub">
            <summary>📚 Sources — reference docs in context ({story.sources.length})</summary>
            <div className="sub-body">
              <p className="muted xs">Lore, a style sample, world notes — the model draws on these like a text LoRA.</p>
              <SourcesPanel sources={story.sources} onChange={(s) => updateStory(story.id, { sources: s })} />
            </div>
          </details>

          <div className="field">
            <span>Length — ~{story.targetWords.toLocaleString()} words (~{pages(story.targetWords)} pages)</span>
            <div className="row gap wrap">
              {LENGTHS.map((l) => (
                <button key={l.label} type="button" className={cx('chip', story.targetWords === l.words && 'sel')} onClick={() => updateStory(story.id, { targetWords: l.words })}>
                  {l.label} · ~{pages(l.words)}pg
                </button>
              ))}
              <input
                type="number"
                min={200}
                max={20000}
                step={200}
                value={story.targetWords}
                onChange={(e) => updateStory(story.id, { targetWords: Math.max(200, Math.min(20000, Number(e.target.value))) })}
                className="num-input wide"
              />
            </div>
            <span className="muted xs">Long stories write in several passes — it keeps developing instead of racing to the end. Stop anytime; partial work is kept.</span>
          </div>

          <div className="row gap">
            {busy ? (
              <button className="btn stop" onClick={() => abortRef.current?.abort()}>
                ■ Stop
              </button>
            ) : (
              <>
                <button className="btn" onClick={() => run(false)}>
                  {story.beats.length ? '↻ Regenerate' : '▶ Write story'}
                </button>
                {story.beats.length > 0 && (
                  <button className="btn ghost" onClick={() => run(true)}>
                    + Continue
                  </button>
                )}
              </>
            )}
            {progress && (
              <div className="gen-progress">
                <span className="muted sm">
                  writing… {progress.words.toLocaleString()} / ~{progress.target.toLocaleString()} words
                </span>
                <div className="progress">
                  <div className="progress-bar" style={{ width: `${Math.min(100, (progress.words / progress.target) * 100)}%` }} />
                </div>
              </div>
            )}
          </div>
          {error && <div className="error-line">{error}</div>}
        </div>

        <div className="story">
          {busy && !streamText && (
            <div className="planning">
              <div className="planning-head">
                <span className="typing">✍️</span> Planning the scene…
              </div>
              {reasoningText && <div className="planning-reasoning">{reasoningText.slice(-1400)}</div>}
            </div>
          )}
          {(liveBeats ?? (busy ? [] : story.beats)).map((b, i) => (
            <p key={i} className={cx('sp', b.type === 'narration' ? 'sp-narration' : 'sp-line')}>
              {b.type !== 'narration' && (
                <span className="sp-name" style={{ color: colorFor(b.speaker) }}>
                  {b.speaker}
                </span>
              )}
              <span className="sp-text">{inline(b.text)}</span>
            </p>
          ))}
          {!busy && story.beats.length === 0 && <div className="muted pad">No story yet — set it up above, then Write.</div>}
        </div>
      </div>
    </div>
  )
}
