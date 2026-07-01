import { useEffect, useMemo, useRef, useState } from 'react'
import { setVisionMode, extractPdf, retrieveContext } from '../tauri'
import { useStore } from '../store'
import { useConfirm } from './ConfirmDialog'
import { streamChatNative, samplerFromSettings, getEngineStatus, runIntentClassifier, type ContentPart } from '../api/ollama'
import { friendlyModelName } from '../models'
import { expertIcon } from '../expertIcons'
import { ExpertPicker } from './ExpertPicker'
import { findVisionModel } from '../visionModels'
import {
  buildClassifierPrompt,
  parseClassification,
  isActionable,
  looksActionable,
  heuristicIntent,
  describeIntent,
  normalizeDocFormat,
  type Classification,
} from '../intent'
import { Markdown } from './Markdown'
import { MessageInput } from './MessageInput'
import { ExpertEditor } from './ExpertEditor'
import { FolderGrant } from './FolderGrant'
import { DocumentModal } from './DocumentModal'
import { ImageFinderModal } from './ImageFinderModal'
import { cx } from '../util'

// A roomy-but-safe context window for Q&A threads (the model/Modelfile default
// can be as low as 4k, which truncates multi-turn clarifications).
const ASK_NUM_CTX = 8192

const fileToDataUrl = (f: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = reject
    r.readAsDataURL(f)
  })

const TEXT_RE = /\.(txt|md|markdown|text|html?|css|jsx?|tsx?|json|csv|xml|ya?ml|java|py|rs|go|c|cpp|h|sh|sql|log|ini|toml)$/i

export function AskView() {
  const asks = useStore((s) => s.asks)
  const activeAskId = useStore((s) => s.activeAskId)
  const experts = useStore((s) => s.experts)
  const settings = useStore((s) => s.settings)
  const loadedModel = useStore((s) => s.loadedModel)
  const createAsk = useStore((s) => s.createAsk)
  const updateAsk = useStore((s) => s.updateAsk)
  const deleteAsk = useStore((s) => s.deleteAsk)
  const addAskMessage = useStore((s) => s.addAskMessage)
  const clearAskThread = useStore((s) => s.clearAskThread)
  const confirm = useConfirm()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [managing, setManaging] = useState(false)
  const [showDoc, setShowDoc] = useState(false)
  const [showFinder, setShowFinder] = useState(false)
  const [pending, setPending] = useState<{ name: string; url: string }[]>([])
  const [lastImages, setLastImages] = useState<{ name: string; url: string }[]>([])
  const [pendingText, setPendingText] = useState<{ name: string; text: string }[]>([])
  const [dragOver, setDragOver] = useState(false)
  const mode = useStore((s) => s.engineMode)
  const setEngineMode = useStore((s) => s.setEngineMode)
  const [swapping, setSwapping] = useState(false)
  const [intent, setIntent] = useState<{ c: Classification; text: string } | null>(null)
  const [classifying, setClassifying] = useState(false)
  const [finderCriterion, setFinderCriterion] = useState('')
  const [docPrefill, setDocPrefill] = useState<{ request: string; format?: string } | null>(null)
  const classifyCache = useRef<Map<string, Classification | null>>(new Map())
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const ask = useMemo(() => asks.find((a) => a.id === activeAskId) ?? null, [asks, activeAskId])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [ask?.messages, busy])

  const modelName = friendlyModelName(loadedModel || settings.model)

  if (!ask) {
    return (
      <div className="chat empty-state">
        <div>
          <h1>🪄 Ask {modelName}</h1>
          <p className="muted">
            A multi-turn expert assistant. Pick an "expert" rule set, ask anything, and keep the thread going — it
            remembers the conversation, so it can ask a clarifying question and you can answer.
          </p>
          <button className="btn" onClick={() => createAsk()}>
            + New ask
          </button>
        </div>
      </div>
    )
  }

  const expert = experts.find((e) => e.id === ask.expertId) ?? experts[0] ?? null

  const addFiles = async (files: File[]) => {
    const imgs: { name: string; url: string }[] = []
    const texts: { name: string; text: string }[] = []
    for (const f of files) {
      if (f.type.startsWith('image/')) {
        imgs.push({ name: f.name, url: await fileToDataUrl(f) })
      } else if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
        try {
          const buf = new Uint8Array(await f.arrayBuffer())
          const text = await extractPdf(Array.from(buf))
          if (text.trim()) texts.push({ name: f.name, text })
        } catch (e) {
          setError(`Couldn't read ${f.name}: ${(e as { message?: string })?.message ?? e}`)
        }
      } else if (TEXT_RE.test(f.name) || f.type.startsWith('text/')) {
        try {
          const text = await f.text()
          if (text.trim()) texts.push({ name: f.name, text })
        } catch {
          /* unreadable — skip */
        }
      } else {
        setError(`${f.name} isn't supported — drop an image, PDF, or text / code file.`)
      }
    }
    if (imgs.length) setPending((p) => [...p, ...imgs].slice(0, 6))
    if (texts.length) setPendingText((p) => [...p, ...texts].slice(0, 8))
  }

  const waitReady = async () => {
    for (let i = 0; i < 200; i++) {
      await new Promise((r) => setTimeout(r, 1500))
      try {
        if ((await getEngineStatus(settings.baseUrl)) === 'ready') return
      } catch {
        /* keep waiting */
      }
    }
    throw new Error('Engine did not come back up.')
  }

  // Swap the loaded model: image mode loads the vision model; text mode reloads the main model.
  const switchMode = async (next: 'text' | 'image') => {
    if (next === mode || swapping || busy) return
    const vm = findVisionModel(settings.visionModel)
    if (next === 'image' && !vm) {
      setError('Pick a vision model in Settings (the gear) first.')
      return
    }
    setSwapping(true)
    setError('')
    try {
      await setVisionMode(next === 'image', vm?.textFile ?? '', vm?.mmprojFile ?? '')
      await waitReady()
      setEngineMode(next)
      if (next === 'text') setPending([])
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Could not switch mode.')
    } finally {
      setSwapping(false)
    }
  }

  const sendChat = async (text: string) => {
    if ((!text.trim() && pending.length === 0 && pendingText.length === 0) || busy || swapping) return
    if (pending.length && mode === 'text') {
      setError('Switch to 👁 Image mode to analyze the attached image(s).')
      return
    }
    // In image mode, reuse the last image when none is newly attached.
    const imgs = mode === 'image' ? (pending.length ? pending : lastImages) : []
    const texts = pendingText
    if (mode === 'image' && imgs.length === 0 && texts.length === 0) {
      setError('Attach an image or a file — drag one in or use 📎 (or switch to 💬 Text mode).')
      return
    }
    const sys =
      expert?.systemPrompt?.trim() ||
      'You are a decisive, knowledgeable expert assistant. Answer the question directly and usefully.'
    const userText =
      text.trim() ||
      (imgs.length ? 'Describe and answer about the attached image(s).' : texts.length ? 'Use the attached file(s) to answer.' : '')
    if (!userText && !imgs.length && !texts.length) return
    // Attached file text becomes context prepended to the question.
    const attached = texts.map((a) => `--- Attached file: ${a.name} ---\n${a.text.slice(0, 12000)}`).join('\n\n')
    const body = attached ? `${attached}\n\n${userText}` : userText

    if (!ask.title.trim() && text.trim()) updateAsk(ask.id, { title: text.slice(0, 60) })
    const noteBits: string[] = []
    if (imgs.length) noteBits.push(`${imgs.length} image${imgs.length > 1 ? 's' : ''}`)
    if (texts.length) noteBits.push(texts.map((t) => t.name).join(', '))
    const note = noteBits.length ? `\n\n_[attached: ${noteBits.join(' · ')}]_` : ''
    const userId = addAskMessage(ask.id, { role: 'user', content: userText + note })
    const assistantId = addAskMessage(ask.id, { role: 'assistant', content: '', reasoning: '' })
    setPending([])
    setPendingText([])
    if (mode === 'image') setLastImages(imgs)

    // Prior thread (exclude the just-added user + placeholder); the new user turn is appended below.
    const cur = useStore.getState().asks.find((a) => a.id === ask.id)
    const histPrev = (cur?.messages ?? [])
      .filter((m) => m.id !== assistantId && m.id !== userId && !m.error)
      .map((m) => ({ role: m.role, content: m.content }))

    const ctrl = new AbortController()
    abortRef.current = ctrl
    setBusy(true)
    setError('')
    try {
      // Knowledge folder: fold the passages most relevant to this question into the system prompt.
      let sysFull = sys
      if (ask.knowledgeFolder) {
        try {
          const kb = await retrieveContext(ask.knowledgeFolder, userText, 6000)
          if (kb.trim()) {
            sysFull = `${sys}\n\n# Reference material from the user's folder\nUse it to answer accurately and cite file names when relevant; if it doesn't cover the question, say so.\n\n${kb}`
          }
        } catch {
          /* folder moved or unreadable — skip it */
        }
      }
      const handlers = {
        onReasoning: (d: string) => useStore.getState().appendToAskMessage(ask.id, assistantId, { reasoning: d }),
        onContent: (d: string) => useStore.getState().appendToAskMessage(ask.id, assistantId, { content: d }),
      }
      // Image mode = a single user turn (no system role / history) so Gemma's strict template
      // is satisfied; the system prompt + attached-file text fold into that turn. Text mode =
      // normal system + history to the main model.
      const foldedBody = sysFull ? `${sysFull}\n\n${body}` : body
      const messages =
        mode === 'image'
          ? [
              {
                role: 'user',
                content: imgs.length
                  ? ([
                      { type: 'text', text: foldedBody },
                      ...imgs.map((i) => ({ type: 'image_url' as const, image_url: { url: i.url } })),
                    ] as ContentPart[])
                  : foldedBody,
              },
            ]
          : [{ role: 'system', content: sysFull }, ...histPrev, { role: 'user', content: body }]
      await streamChatNative({
        baseUrl: settings.baseUrl,
        model: settings.model,
        messages,
        temperature: settings.temperature,
        topP: settings.topP,
        sampler: samplerFromSettings(settings),
        think: mode === 'image' ? false : ask.think,
        numCtx: ASK_NUM_CTX,
        signal: ctrl.signal,
        handlers,
      })
    } catch (e) {
      const err = e as { name?: string; message?: string }
      if (err?.name !== 'AbortError') {
        setError(err?.message ?? 'Generation failed.')
        useStore.getState().updateAskMessage(ask.id, assistantId, {
          content: `⚠️ ${err?.message ?? 'Generation failed'}`,
          error: true,
        })
      }
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  // Control net: route the prompt through intent classification first (text mode only).
  // Off → never; Quick → only when it looks like a task; Full → always. On a confident
  // match we surface a one-click suggestion instead of sending; otherwise it's a normal chat.
  const send = async (text: string) => {
    const t = text.trim()
    const canRoute =
      settings.intentRouter !== 'off' &&
      mode === 'text' &&
      !busy &&
      !swapping &&
      t.length > 0 &&
      pending.length === 0 &&
      pendingText.length === 0
    if (!canRoute) return sendChat(text)
    // 1) Deterministic fast-path — reliable for the obvious cases, no model call, never
    //    silently fails. This is what guarantees the one-click action appears.
    const hit = heuristicIntent(t)
    if (hit) {
      setError('')
      setIntent({ c: hit, text })
      return
    }
    // 2) LLM classifier for fuzzier phrasing (Quick gates on the keyword pre-filter).
    if (settings.intentRouter === 'quick' && !looksActionable(t)) return sendChat(text)
    setError('')
    setClassifying(true)
    try {
      let c = classifyCache.current.get(t)
      if (c === undefined) {
        const raw = await runIntentClassifier(settings.baseUrl, buildClassifierPrompt(t))
        c = parseClassification(raw)
        classifyCache.current.set(t, c)
      }
      if (isActionable(c)) {
        setIntent({ c, text })
        return
      }
    } catch {
      /* classifier unreachable / bad output — fall through to a normal chat */
    } finally {
      setClassifying(false)
    }
    return sendChat(text)
  }

  // Map a confirmed suggestion onto the matching workflow (prefilled where we can).
  const runIntent = (sel: { c: Classification; text: string }) => {
    const { c, text } = sel
    setIntent(null)
    switch (c.intent) {
      case 'find_images_pdf':
        setFinderCriterion(c.params.criterion || '')
        setShowFinder(true)
        break
      case 'generate_document':
        setDocPrefill({ request: c.params.topic || text, format: normalizeDocFormat(c.params.format) })
        setShowDoc(true)
        break
      case 'edit_file':
        setDocPrefill({ request: c.params.change || text })
        setShowDoc(true)
        break
      case 'analyze_image':
        switchMode('image')
        break
      case 'answer_from_folder':
        if (ask.knowledgeFolder) sendChat(text)
        else setError('Attach a folder first (📁 above), then ask again — I’ll answer from it.')
        break
      default:
        sendChat(text)
    }
  }

  return (
    <div
      className="chat"
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        addFiles(Array.from(e.dataTransfer.files))
      }}
      style={dragOver ? { outline: '2px dashed var(--corona, #5EEAD4)', outlineOffset: -6 } : undefined}
    >
      <header className="chat-head">
        <div className="chat-title">🪄 Ask {modelName}</div>
        <div className="row gap">
          <button className="btn sm ghost" onClick={() => createAsk()}>
            + New
          </button>
          <button
            className="btn sm ghost"
            onClick={async () => { if (await confirm({ title: 'Clear thread?', message: 'All messages in this thread will be cleared.', confirmLabel: 'Clear' })) clearAskThread(ask.id) }}
            disabled={!ask.messages.length || busy}
          >
            Clear thread
          </button>
          <button className="btn sm ghost danger" onClick={async () => { if (await confirm({ title: 'Delete thread?', message: 'This Ask thread will be permanently deleted.', confirmLabel: 'Delete' })) deleteAsk(ask.id) }}>
            Delete
          </button>
        </div>
      </header>

      <div className="row gap wrap" style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
        <label className="muted xs">Expert</label>
        <ExpertPicker
          experts={experts}
          value={ask.expertId ?? experts[0]?.id ?? ''}
          onChange={(id) => updateAsk(ask.id, { expertId: id || null })}
        />
        <button className="btn sm ghost" onClick={() => setManaging(true)}>
          ✎ Experts
        </button>
        <div className="seg" title="Text uses your main model; Image swaps in the vision model (reloads on switch)">
          <button type="button" className={cx('seg-btn', mode === 'text' && 'sel')} disabled={swapping || busy} onClick={() => switchMode('text')}>
            💬 Text
          </button>
          <button type="button" className={cx('seg-btn', mode === 'image' && 'sel')} disabled={swapping || busy} onClick={() => switchMode('image')}>
            {swapping ? '⏳' : '👁 Image'}
          </button>
        </div>
        <div className="seg">
          <button type="button" className={cx('seg-btn', !ask.think && 'sel')} onClick={() => updateAsk(ask.id, { think: false })}>
            No reasoning
          </button>
          <button type="button" className={cx('seg-btn', ask.think && 'sel')} onClick={() => updateAsk(ask.id, { think: true })}>
            Reason
          </button>
        </div>
        <div style={{ flex: 1 }} />
        <FolderGrant
          folder={ask.knowledgeFolder}
          onSetFolder={(p) => updateAsk(ask.id, { knowledgeFolder: p ?? undefined })}
          compact
        />
        <button
          className="btn sm ghost"
          onClick={() => {
            setDocPrefill(null)
            setShowDoc(true)
          }}
          title="Generate a document (PDF or text / code) and save it to your folder"
        >
          📄 Document
        </button>
        <button
          className="btn sm ghost"
          onClick={() => {
            setFinderCriterion('')
            setShowFinder(true)
          }}
          title="Scan a folder of images, keep the ones matching a description, build a PDF"
        >
          🔎 Images→PDF
        </button>
        {mode === 'image' && (
          <>
            <button className="btn sm ghost" onClick={() => fileRef.current?.click()} title="Attach image(s) to analyze">
              📎 Image
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []))
                if (fileRef.current) fileRef.current.value = ''
              }}
            />
          </>
        )}
      </div>

      <div className="messages" ref={scrollRef}>
        {ask.messages.length === 0 && (
          <div className="muted pad">
            {expert ? (
              <>
                Asking as <strong>{(expert.emoji ? expert.emoji + ' ' : '') + expert.name}</strong>. Ask anything — the
                whole thread is remembered, so you can answer its follow-ups.
              </>
            ) : (
              'Create an expert to begin.'
            )}
          </div>
        )}
        {ask.messages.map((m, i) => {
          const isUser = m.role === 'user'
          const isLast = i === ask.messages.length - 1
          const expIcon = !isUser ? expertIcon(expert?.id) : undefined
          return (
            <div key={m.id} className={cx('msg', isUser ? 'msg-user' : 'msg-assistant', m.error && 'msg-error')}>
              <div
                className={cx('msg-avatar', expIcon && 'has-portrait')}
                style={{ background: isUser ? '#2a2342' : expIcon ? 'transparent' : 'var(--accent)' }}
              >
                {isUser ? '🧑' : expIcon ? <img src={expIcon} alt="" /> : expert?.emoji || '🪄'}
              </div>
              <div className="msg-body">
                {m.reasoning && (
                  <details className="reasoning">
                    <summary>💭 Reasoning</summary>
                    <div className="reasoning-body">{m.reasoning}</div>
                  </details>
                )}
                {m.content ? (
                  <Markdown>{m.content}</Markdown>
                ) : busy && isLast ? (
                  <div className="typing">▋</div>
                ) : (
                  <div className="muted empty-msg">(empty)</div>
                )}
                {!isUser && m.content && (
                  <div className="msg-actions">
                    <button className="icon-btn" title="Copy" onClick={() => navigator.clipboard?.writeText(m.content)}>
                      ⧉
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {swapping && (
          <div className="muted" style={{ padding: '4px 14px' }}>
            ⏳ Switching model — this reloads the engine and can take a bit…
          </div>
        )}
        {mode === 'image' && !swapping && (
          <div className="muted xs" style={{ padding: '2px 14px' }}>
            👁 Image mode — drop or attach an image and ask about it. Switch back to 💬 Text for your main model.
          </div>
        )}
        {error && (
          <div className="error-line" role="alert">
            {error}
          </div>
        )}
      </div>

      {pending.length > 0 && (
        <div className="row gap wrap" style={{ padding: '6px 14px 0' }}>
          {pending.map((p, i) => (
            <span
              key={i}
              className="row gap"
              style={{ alignItems: 'center', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 6px 2px 2px' }}
            >
              <img src={p.url} alt={p.name} style={{ height: 34, width: 34, objectFit: 'cover', borderRadius: 4 }} />
              <span className="muted xs" style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.name}
              </span>
              <button className="icon-btn sm" title="Remove" onClick={() => setPending(pending.filter((_, j) => j !== i))}>
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      {pendingText.length > 0 && (
        <div className="row gap wrap" style={{ padding: '6px 14px 0' }}>
          {pendingText.map((p, i) => (
            <span
              key={i}
              className="row gap"
              style={{ alignItems: 'center', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 6px', fontSize: 12 }}
              title={`${p.name} · ${p.text.length.toLocaleString()} chars`}
            >
              📄
              <span className="muted xs" style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.name}
              </span>
              <button className="icon-btn sm" title="Remove" onClick={() => setPendingText(pendingText.filter((_, j) => j !== i))}>
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      {classifying && (
        <div className="row gap" role="status" style={{ padding: '8px 14px 0', alignItems: 'center' }}>
          <span className="muted xs">🧭 Reading your request…</span>
        </div>
      )}
      {intent && (
        <div
          aria-live="polite"
          style={{
            margin: '8px 14px 0',
            padding: '10px 12px',
            border: '1px solid var(--corona, #5EEAD4)',
            borderRadius: 10,
            background: 'rgba(94,234,212,.06)',
          }}
        >
          <div style={{ fontSize: 13, marginBottom: 8 }}>
            <span style={{ opacity: 0.8 }}>Looks like: </span>
            <b>{describeIntent(intent.c)}</b>
            {intent.c.clarify ? <span className="muted"> — {intent.c.clarify}</span> : null}
          </div>
          <div className="row gap">
            <button className="btn sm" onClick={() => intent && runIntent(intent)}>
              ⚡ Run
            </button>
            <button
              className="btn sm ghost"
              onClick={() => {
                if (!intent) return
                const t = intent.text
                setIntent(null)
                sendChat(t)
              }}
            >
              💬 Just chat
            </button>
          </div>
        </div>
      )}
      <MessageInput disabled={busy || swapping} streaming={busy} onSend={send} onStop={() => abortRef.current?.abort()} />

      {managing && <ExpertEditor onClose={() => setManaging(false)} />}
      {showDoc && (
        <DocumentModal
          folder={ask.knowledgeFolder}
          onSetFolder={(p) => updateAsk(ask.id, { knowledgeFolder: p ?? undefined })}
          defaultTitle={ask.title || 'document'}
          defaultExpertId={ask.expertId}
          defaultRequest={docPrefill?.request}
          defaultFormat={docPrefill?.format}
          transcript={{
            label: 'this conversation',
            has: ask.messages.length > 0,
            build: () => ask.messages.map((m) => `${m.role === 'user' ? 'You' : modelName}: ${m.content}`).join('\n\n'),
          }}
          onClose={() => setShowDoc(false)}
        />
      )}
      {showFinder && (
        <ImageFinderModal
          folder={ask.knowledgeFolder}
          onSetFolder={(p) => updateAsk(ask.id, { knowledgeFolder: p ?? undefined })}
          defaultCriterion={finderCriterion}
          onClose={() => setShowFinder(false)}
        />
      )}
    </div>
  )
}
