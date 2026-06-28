export interface ApiMessage {
  role: string
  content: string
}

export interface StreamHandlers {
  onReasoning?: (delta: string) => void
  onContent?: (delta: string) => void
}

export interface StreamOptions {
  baseUrl: string
  model: string
  messages: ApiMessage[]
  temperature: number
  topP: number
  maxTokens: number
  reasoningEffort?: string // 'low' | 'medium' | 'high' — bounds the reasoning trace
  signal?: AbortSignal
  handlers?: StreamHandlers
}

/** Strip the trailing /v1 to reach Ollama's native API root. */
function nativeRoot(baseUrl: string): string {
  return baseUrl.endsWith('/v1') ? baseUrl.slice(0, -3) : baseUrl
}

/**
 * Set the model's keep_alive via the native /api/generate (no prompt = just
 * manage the model). -1 pins it in VRAM, 0 unloads now, or a duration like '5m'.
 */
export async function setKeepAlive(baseUrl: string, model: string, keepAlive: number | string): Promise<void> {
  try {
    await fetch(`${nativeRoot(baseUrl)}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, keep_alive: keepAlive }),
    })
  } catch {
    /* best-effort */
  }
}

/** Unload then reload the model fresh — flushes its loaded context / KV cache. */
export async function reloadModel(baseUrl: string, model: string, keepAlive: number | string): Promise<void> {
  await setKeepAlive(baseUrl, model, 0)
  await setKeepAlive(baseUrl, model, keepAlive)
}

/** Which models are currently loaded (native /api/ps). */
export async function getLoadedModels(baseUrl: string): Promise<string[]> {
  // llama.cpp reports readiness on /health once the model is loaded.
  try {
    const r = await fetch(`${nativeRoot(baseUrl)}/health`)
    if (!r.ok) return []
    const d = await r.json().catch(() => ({}))
    return d.status === 'ok' ? ['loaded'] : []
  } catch {
    return []
  }
}

/** Three-state engine readiness: down (not up yet) | loading (model loading) | ready. */
export async function getEngineStatus(baseUrl: string): Promise<'down' | 'loading' | 'ready'> {
  try {
    const r = await fetch(`${nativeRoot(baseUrl)}/health`)
    return r.ok ? 'ready' : 'loading' // llama.cpp returns 503 while still loading the model
  } catch {
    return 'down'
  }
}

/** List model ids from the OpenAI-compatible /models endpoint. */
export async function listModels(baseUrl: string): Promise<string[]> {
  try {
    const r = await fetch(`${baseUrl}/models`)
    if (!r.ok) return []
    const data = await r.json()
    return (data.data ?? [])
      .map((m: { id: string }) => m.id)
      .sort((a: string, b: string) => a.localeCompare(b))
  } catch {
    return []
  }
}

/**
 * Stream a chat completion from Ollama's OpenAI-compatible endpoint.
 *
 * This model is a reasoning model: the chain-of-thought arrives in a separate
 * `reasoning` delta field and the answer in `content`. Both are surfaced via
 * handlers and returned. We deliberately omit max_tokens when it is 0 — a low
 * cap is consumed entirely by reasoning, leaving an empty answer.
 */
export async function streamChat(opts: StreamOptions): Promise<{ content: string; reasoning: string }> {
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    temperature: opts.temperature,
    top_p: opts.topP,
    stream: true,
  }
  if (opts.maxTokens && opts.maxTokens > 0) body.max_tokens = opts.maxTokens
  if (opts.reasoningEffort) body.reasoning_effort = opts.reasoningEffort

  const resp = await fetch(`${opts.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: opts.signal,
  })

  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => '')
    throw new Error(`HTTP ${resp.status} ${resp.statusText}${text ? ` — ${text}` : ''}`)
  }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let reasoning = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE frames are separated by newlines; keep the trailing partial line.
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') continue
      try {
        const json = JSON.parse(data)
        const delta = json.choices?.[0]?.delta ?? {}
        if (delta.reasoning) {
          reasoning += delta.reasoning
          opts.handlers?.onReasoning?.(delta.reasoning)
        }
        if (delta.content) {
          content += delta.content
          opts.handlers?.onContent?.(delta.content)
        }
      } catch {
        // Ignore partial/non-JSON frames; the next chunk completes them.
      }
    }
  }

  return { content, reasoning }
}

export interface NativeStreamOptions {
  baseUrl: string
  model: string
  messages: ApiMessage[]
  temperature: number
  topP: number
  think: boolean // false = no reasoning (fast, no runaway); true = full reasoning
  numCtx?: number // Ollama context window (num_ctx); omit to use the model/Modelfile default
  signal?: AbortSignal
  handlers?: StreamHandlers
}

/**
 * Stream from the native /api/chat endpoint. Unlike the OpenAI path, this one
 * honours `think` — `false` fully disables the reasoning trace, which is what
 * keeps long roleplay chats fast (the OpenAI endpoint ignores it and the
 * reasoning balloons to ~10k tokens/turn as context grows).
 */
export async function streamChatNative(opts: NativeStreamOptions): Promise<{ content: string; reasoning: string }> {
  // llama.cpp's OpenAI-compatible streaming endpoint (replaces Ollama's /api/chat).
  // Reasoning is controlled server-side via --reasoning; when on, the trace arrives
  // in delta.reasoning_content. think/numCtx are kept for call-site compatibility.
  const resp = await fetch(`${opts.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      temperature: opts.temperature,
      top_p: opts.topP,
      stream: true,
    }),
    signal: opts.signal,
  })
  if (!resp.ok || !resp.body) {
    const text = await resp.text().catch(() => '')
    throw new Error(`HTTP ${resp.status} ${resp.statusText}${text ? ` — ${text}` : ''}`)
  }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let reasoning = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') continue
      try {
        const json = JSON.parse(data)
        const delta = json.choices?.[0]?.delta ?? {}
        const r = delta.reasoning_content ?? delta.reasoning
        if (r) {
          reasoning += r
          opts.handlers?.onReasoning?.(r)
        }
        if (delta.content) {
          content += delta.content
          opts.handlers?.onContent?.(delta.content)
        }
      } catch {
        // ignore partial/non-JSON frames
      }
    }
  }

  return { content, reasoning }
}
