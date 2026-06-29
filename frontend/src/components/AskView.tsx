import { useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useStore } from '../store'
import { streamChatNative, samplerFromSettings, getEngineStatus, type ContentPart } from '../api/ollama'
import { friendlyModelName } from '../models'
import { findVisionModel, type VisionModel } from '../visionModels'
import { Markdown } from './Markdown'
import { MessageInput } from './MessageInput'
import { ExpertEditor } from './ExpertEditor'
import { FolderGrant } from './FolderGrant'
import { DocumentModal } from './DocumentModal'
import { cx } from '../util'

// A roomy-but-safe context window for Q&A threads (the model/Modelfile default
// can be as low as 4k, which truncates multi-turn clarifications).
const ASK_NUM_CTX = 8192
const VISION_BASE = 'http://127.0.0.1:11436/v1'

const fileToDataUrl = (f: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as string)
    r.onerror = reject
    r.readAsDataURL(f)
  })

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

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [managing, setManaging] = useState(false)
  const [showDoc, setShowDoc] = useState(false)
  const [pending, setPending] = useState<{ name: string; url: string }[]>([])
  const [dragOver, setDragOver] = useState(false)
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
    const imgs = files.filter((f) => f.type.startsWith('image/'))
    if (!imgs.length) return
    const urls = await Promise.all(imgs.map(async (f) => ({ name: f.name, url: await fileToDataUrl(f) })))
    setPending((prev) => [...prev, ...urls].slice(0, 6))
  }

  // Start the vision engine (second port) if it isn't already serving, and wait for it.
  const ensureVision = async (vm: VisionModel) => {
    try {
      if ((await getEngineStatus(VISION_BASE)) === 'ready') return
    } catch {
      /* not up yet */
    }
    await invoke('start_vision', { textFile: vm.textFile, mmprojFile: vm.mmprojFile, stopMain: false })
    for (let i = 0; i < 160; i++) {
      await new Promise((r) => setTimeout(r, 1500))
      try {
        if ((await getEngineStatus(VISION_BASE)) === 'ready') return
      } catch {
        /* keep waiting */
      }
    }
    throw new Error('Vision model did not load — it may not fit in VRAM alongside your main model. Try Gemma 3 4B in Settings.')
  }

  const send = async (text: string) => {
    if ((!text.trim() && pending.length === 0) || busy) return
    const imgs = pending
    let vm: VisionModel | null = null
    if (imgs.length) {
      vm = findVisionModel(settings.visionModel)
      if (!vm) {
        setError('Pick a vision model in Settings (the gear) to analyze images.')
        return
      }
    }
    const sys =
      expert?.systemPrompt?.trim() ||
      'You are a decisive, knowledgeable expert assistant. Answer the question directly and usefully.'
    const userText = text.trim() || 'Describe and answer about the attached image(s).'

    if (!ask.title.trim() && text.trim()) updateAsk(ask.id, { title: text.slice(0, 60) })
    const note = imgs.length ? `\n\n_[${imgs.length} image${imgs.length > 1 ? 's' : ''}: ${imgs.map((i) => i.name).join(', ')}]_` : ''
    const userId = addAskMessage(ask.id, { role: 'user', content: userText + note })
    const assistantId = addAskMessage(ask.id, { role: 'assistant', content: '', reasoning: '' })
    setPending([])

    // Prior thread (exclude the just-added user + placeholder); the new user turn is appended per-mode.
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
          const kb = await invoke<string>('retrieve_context', { path: ask.knowledgeFolder, query: userText, maxChars: 6000 })
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
      if (vm) {
        // Image turn → route to the vision engine with a multimodal message.
        await ensureVision(vm)
        const content: ContentPart[] = [
          { type: 'text', text: userText },
          ...imgs.map((i) => ({ type: 'image_url' as const, image_url: { url: i.url } })),
        ]
        const messages = [{ role: 'system', content: sysFull }, ...histPrev, { role: 'user', content }]
        await streamChatNative({
          baseUrl: VISION_BASE,
          model: 'vision',
          messages,
          temperature: settings.temperature,
          topP: settings.topP,
          think: false,
          numCtx: ASK_NUM_CTX,
          signal: ctrl.signal,
          handlers,
        })
      } else {
        const messages = [{ role: 'system', content: sysFull }, ...histPrev, { role: 'user', content: userText }]
        await streamChatNative({
          baseUrl: settings.baseUrl,
          model: settings.model,
          messages,
          temperature: settings.temperature,
          topP: settings.topP,
          sampler: samplerFromSettings(settings),
          think: ask.think,
          numCtx: ASK_NUM_CTX,
          signal: ctrl.signal,
          handlers,
        })
      }
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
          <button className="btn sm ghost" onClick={() => clearAskThread(ask.id)} disabled={!ask.messages.length || busy}>
            Clear thread
          </button>
          <button className="btn sm ghost danger" onClick={() => deleteAsk(ask.id)}>
            Delete
          </button>
        </div>
      </header>

      <div className="row gap wrap" style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', alignItems: 'center' }}>
        <label className="muted xs">Expert</label>
        <select
          value={ask.expertId ?? experts[0]?.id ?? ''}
          style={{ minWidth: 200 }}
          onChange={(e) => updateAsk(ask.id, { expertId: e.target.value || null })}
        >
          {experts.map((ex) => (
            <option key={ex.id} value={ex.id}>
              {(ex.emoji ? ex.emoji + ' ' : '') + ex.name}
            </option>
          ))}
        </select>
        <button className="btn sm ghost" onClick={() => setManaging(true)}>
          ✎ Experts
        </button>
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
          onClick={() => setShowDoc(true)}
          title="Generate a document (PDF or text / code) and save it to your folder"
        >
          📄 Document
        </button>
        <button
          className="btn sm ghost"
          onClick={() => fileRef.current?.click()}
          title="Attach image(s) to analyze with the vision model"
        >
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
          return (
            <div key={m.id} className={cx('msg', isUser ? 'msg-user' : 'msg-assistant', m.error && 'msg-error')}>
              <div className="msg-avatar" style={{ background: isUser ? '#2a2342' : 'var(--accent)' }}>
                {isUser ? '🧑' : expert?.emoji || '🪄'}
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
        {error && <div className="error-line">{error}</div>}
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
      <MessageInput disabled={busy} streaming={busy} onSend={send} onStop={() => abortRef.current?.abort()} />

      {managing && <ExpertEditor onClose={() => setManaging(false)} />}
      {showDoc && (
        <DocumentModal
          folder={ask.knowledgeFolder}
          onSetFolder={(p) => updateAsk(ask.id, { knowledgeFolder: p ?? undefined })}
          defaultTitle={ask.title || 'document'}
          defaultExpertId={ask.expertId}
          transcript={{
            label: 'this conversation',
            has: ask.messages.length > 0,
            build: () => ask.messages.map((m) => `${m.role === 'user' ? 'You' : modelName}: ${m.content}`).join('\n\n'),
          }}
          onClose={() => setShowDoc(false)}
        />
      )}
    </div>
  )
}
