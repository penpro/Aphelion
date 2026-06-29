import { useCallback, useRef, useState } from 'react'
import { useStore } from './store'
import { invoke } from '@tauri-apps/api/core'
import { streamChatNative, reloadModel, proofread, samplerFromSettings } from './api/ollama'
import { buildApiMessages, estTokens } from './prompt'
import { distillMessages, compactSummary, LIVE_WINDOW_TOKENS, KEEP_RECENT_TOKENS, SUMMARY_CAP_TOKENS } from './memory'
import type { Character } from './types'

/**
 * Drives streaming generations against the active chat. All reads use
 * useStore.getState() so the latest store data is used even mid-stream.
 */
export function useGeneration() {
  const [isStreaming, setStreaming] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  // The cast signature last generated per chat, so we can flush the KV cache when
  // the cast changes (otherwise a newly added character is ignored until reload).
  const lastCastRef = useRef<Record<string, string>>({})
  const [memoryStatus, setMemoryStatus] = useState('')

  const run = useCallback(async (chatId: string, assistantId: string) => {
    const st = useStore.getState()
    const chat = st.chats.find((c) => c.id === chatId)
    if (!chat) return
    const cast = chat.castIds.map((id) => st.characters.find((c) => c.id === id)).filter(Boolean) as Character[]
    if (!cast.length) return

    // Did the cast change since this chat's last generation (e.g. a character was
    // just added)? If so, flush the model's KV cache below so the updated system
    // prompt takes effect instead of being ignored until a manual reload.
    const castSig = chat.castIds.join(',')
    const prevSig = lastCastRef.current[chatId]
    const castChanged = prevSig !== undefined && prevSig !== castSig
    lastCastRef.current[chatId] = castSig

    // History before the assistant placeholder; messages already folded into the
    // running memory are represented by the summary, not re-sent verbatim.
    const idx = chat.messages.findIndex((m) => m.id === assistantId)
    const fullHistory = idx >= 0 ? chat.messages.slice(0, idx) : chat.messages
    const history = fullHistory.slice(chat.summarizedCount)

    // Rolling context: clamp num_ctx to the model's real 128K ceiling and trim the
    // live tail to fit, so a long chat never overflows the window and stalls.
    const numCtx = Math.min(Math.max(st.settings.contextLength || 8192, 2048), 131072)
    const reserve = chat.tuning.think === 'full' ? 12000 : 3072
    // Knowledge folder: pull the passages most relevant to the latest user message and
    // inject them as a reference source. The app reads the files; the model never does.
    let sources = chat.sources
    if (chat.knowledgeFolder) {
      const lastUser = [...fullHistory].reverse().find((m) => m.role === 'user')?.content
      if (lastUser?.trim()) {
        setMemoryStatus('📚 searching knowledge folder…')
        try {
          const kb = await invoke<string>('retrieve_context', {
            path: chat.knowledgeFolder,
            query: lastUser,
            maxChars: 6000,
          })
          if (kb?.trim()) {
            sources = [...sources, { id: 'kb', name: 'Knowledge folder — relevant excerpts (factual reference)', text: kb }]
          }
        } catch {
          /* folder moved or unreadable — just skip it */
        }
        setMemoryStatus('')
      }
    }

    const apiMessages = buildApiMessages(
      cast,
      st.persona,
      history,
      {
        scenePrompt: chat.scenePrompt,
        tuning: chat.tuning,
        mutedIds: chat.mutedIds,
        sources,
        summary: chat.summary,
      },
      { maxContextTokens: numCtx, reserveTokens: reserve },
    )
    // Opening turn (no prior dialogue): prompt the character to start the scene.
    if (!fullHistory.some((m) => m.role === 'user' || m.role === 'assistant')) {
      apiMessages.push({
        role: 'user',
        content: 'Begin the scene now: write your opening message in character, establishing the moment.',
      })
    }

    const ctrl = new AbortController()
    abortRef.current = ctrl
    setStreaming(true)
    try {
      // Flush stale KV when the cast changed, mirroring the manual model reload that
      // the user found makes newly added characters start participating.
      if (castChanged) {
        await reloadModel(st.settings.baseUrl, st.settings.model, st.settings.keepLoaded ? -1 : '10m')
      }
      const handlers = {
        onReasoning: (d: string) => useStore.getState().appendToMessage(chatId, assistantId, { reasoning: d }),
        onContent: (d: string) => useStore.getState().appendToMessage(chatId, assistantId, { content: d }),
      }
      const common = {
        baseUrl: st.settings.baseUrl,
        model: st.settings.model,
        messages: apiMessages,
        temperature: st.settings.temperature,
        topP: st.settings.topP,
        sampler: samplerFromSettings(st.settings),
        numCtx,
        signal: ctrl.signal,
        handlers,
      }
      // Native endpoint only — it's the one that honours think:false.
      await streamChatNative({ ...common, think: chat.tuning.think === 'full' })

      // Optional proofread pass: fix typos/grammar without changing the content.
      if (st.settings.proofread) {
        const cur = useStore
          .getState()
          .chats.find((c) => c.id === chatId)
          ?.messages.find((m) => m.id === assistantId)
        const raw = cur?.content ?? ''
        if (raw.trim() && !cur?.error) {
          setMemoryStatus('✍️ proofreading…')
          try {
            const fixed = await proofread(st.settings.baseUrl, st.settings.model, raw, ctrl.signal)
            if (fixed.trim()) useStore.getState().updateMessage(chatId, assistantId, { content: fixed })
          } catch {
            /* keep the original reply if proofreading fails or is aborted */
          }
          setMemoryStatus('')
        }
      }
    } catch (e: unknown) {
      const err = e as { name?: string; message?: string }
      if (err?.name !== 'AbortError') {
        useStore.getState().updateMessage(chatId, assistantId, {
          content: `⚠️ ${err?.message ?? 'Generation failed'}`,
          error: true,
        })
      }
    } finally {
      setStreaming(false)
      abortRef.current = null
    }
  }, [])

  // After a turn, if the live (unsummarized) tail has grown past the window, fold the
  // oldest messages into the running memory (and compact it if it's gotten too large).
  // The summarization LLM call fires only every ~25k tokens, so most turns it no-ops.
  const maintainMemory = useCallback(async (chatId: string) => {
    const st = useStore.getState()
    const chat = st.chats.find((c) => c.id === chatId)
    if (!chat) return
    const ctxTokens = Math.min(Math.max(st.settings.contextLength || 8192, 2048), 131072)
    const window = Math.min(LIVE_WINDOW_TOKENS, Math.floor(ctxTokens * 0.7))
    const keepRecent = Math.min(KEEP_RECENT_TOKENS, Math.floor(window / 3))

    const tail = chat.messages.slice(chat.summarizedCount)
    const tailTokens = estTokens(tail.map((m) => m.content).join('\n'))
    if (tailTokens < window) return

    // Keep the most recent `keepRecent` tokens verbatim; fold everything older.
    let recent = 0
    let keepFrom = tail.length
    for (let i = tail.length - 1; i >= 0; i--) {
      recent += estTokens(tail[i].content)
      if (recent > keepRecent) {
        keepFrom = i + 1
        break
      }
      keepFrom = i
    }
    const chunk = tail.slice(0, Math.min(keepFrom, tail.length - 1)) // never fold the very latest message
    if (chunk.length === 0) return

    const cast = chat.castIds.map((id) => st.characters.find((c) => c.id === id)).filter(Boolean) as Character[]
    try {
      setMemoryStatus('🧠 condensing memory…')
      const piece = await distillMessages({
        chunk,
        castNames: cast.map((c) => c.name),
        userName: st.persona.name || 'User',
        settings: st.settings,
      })
      let summary = (chat.summary?.trim() ? chat.summary.trim() + '\n' : '') + piece.trim()
      if (estTokens(summary) > SUMMARY_CAP_TOKENS) {
        setMemoryStatus('🧠 compacting memory…')
        summary = await compactSummary({ summary, settings: st.settings })
      }
      useStore.getState().updateChat(chatId, { summary, summarizedCount: chat.summarizedCount + chunk.length })
    } catch {
      /* best-effort: keep the existing memory if summarization fails */
    } finally {
      setMemoryStatus('')
    }
  }, [])

  const send = useCallback(
    async (chatId: string, text: string) => {
      const st = useStore.getState()
      st.addMessage(chatId, { role: 'user', content: text })
      const assistantId = st.addMessage(chatId, { role: 'assistant', content: '', reasoning: '' })
      await run(chatId, assistantId)
      await maintainMemory(chatId)
    },
    [run, maintainMemory],
  )

  const regenerate = useCallback(
    async (chatId: string, assistantId: string) => {
      useStore.getState().beginSwipe(chatId, assistantId)
      await run(chatId, assistantId)
    },
    [run],
  )

  // Leave the setup panel and generate the character's opening message.
  const begin = useCallback(
    async (chatId: string) => {
      const st = useStore.getState()
      st.updateChat(chatId, { started: true })
      const assistantId = st.addMessage(chatId, { role: 'assistant', content: '', reasoning: '' })
      await run(chatId, assistantId)
    },
    [run],
  )

  const stop = useCallback(() => abortRef.current?.abort(), [])

  return { isStreaming, memoryStatus, send, regenerate, begin, stop }
}
