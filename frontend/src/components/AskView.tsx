import { useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useStore } from '../store'
import { streamChatNative, samplerFromSettings } from '../api/ollama'
import { friendlyModelName } from '../models'
import { Markdown } from './Markdown'
import { MessageInput } from './MessageInput'
import { ExpertEditor } from './ExpertEditor'
import { FolderGrant } from './FolderGrant'
import { DocumentModal } from './DocumentModal'
import { cx } from '../util'

// A roomy-but-safe context window for Q&A threads (the model/Modelfile default
// can be as low as 4k, which truncates multi-turn clarifications).
const ASK_NUM_CTX = 8192

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
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

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

  const send = async (text: string) => {
    if (!text.trim() || busy) return
    const sys =
      expert?.systemPrompt?.trim() ||
      'You are a decisive, knowledgeable expert assistant. Answer the question directly and usefully.'

    if (!ask.title.trim()) updateAsk(ask.id, { title: text.slice(0, 60) })
    addAskMessage(ask.id, { role: 'user', content: text })
    const assistantId = addAskMessage(ask.id, { role: 'assistant', content: '', reasoning: '' })

    // Build the request from the freshest store state: the selected expert as the
    // system message, then the whole thread (everything except the empty placeholder).
    const cur = useStore.getState().asks.find((a) => a.id === ask.id)
    const history = (cur?.messages ?? []).filter((m) => m.id !== assistantId && !m.error)

    const ctrl = new AbortController()
    abortRef.current = ctrl
    setBusy(true)
    setError('')
    try {
      // Knowledge folder: fold the passages most relevant to this question into the system prompt.
      let sysFull = sys
      if (ask.knowledgeFolder) {
        try {
          const kb = await invoke<string>('retrieve_context', { path: ask.knowledgeFolder, query: text, maxChars: 6000 })
          if (kb.trim()) {
            sysFull = `${sys}\n\n# Reference material from the user's folder\nUse it to answer accurately and cite file names when relevant; if it doesn't cover the question, say so.\n\n${kb}`
          }
        } catch {
          /* folder moved or unreadable — skip it */
        }
      }
      const messages = [{ role: 'system', content: sysFull }, ...history.map((m) => ({ role: m.role, content: m.content }))]
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
        handlers: {
          onReasoning: (d) => useStore.getState().appendToAskMessage(ask.id, assistantId, { reasoning: d }),
          onContent: (d) => useStore.getState().appendToAskMessage(ask.id, assistantId, { content: d }),
        },
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

  return (
    <div className="chat">
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

      <MessageInput disabled={busy} streaming={busy} onSend={send} onStop={() => abortRef.current?.abort()} />

      {managing && <ExpertEditor onClose={() => setManaging(false)} />}
      {showDoc && (
        <DocumentModal
          folder={ask.knowledgeFolder}
          onSetFolder={(p) => updateAsk(ask.id, { knowledgeFolder: p ?? undefined })}
          defaultTitle={ask.title || 'document'}
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
