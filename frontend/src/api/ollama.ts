import type { Settings } from '../types'

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }

export interface ApiMessage {
  role: string
  content: string | ContentPart[] // string for text; parts array for multimodal (image) turns
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
  sampler?: SamplerParams
  signal?: AbortSignal
  handlers?: StreamHandlers
}

/** Extra llama.cpp sampler knobs, snake_cased into the request body when present. */
export interface SamplerParams {
  topK?: number
  minP?: number
  typicalP?: number
  repeatPenalty?: number
  repeatLastN?: number
  presencePenalty?: number
  frequencyPenalty?: number
  mirostat?: number
  mirostatTau?: number
  mirostatEta?: number
  dryMultiplier?: number
  dryBase?: number
  dryAllowedLength?: number
  seed?: number
}

/** Map camelCase sampler params to llama.cpp's snake_case request-body fields. */
export function samplerBody(s?: SamplerParams): Record<string, number> {
  const b: Record<string, number> = {}
  if (!s) return b
  if (s.topK !== undefined) b.top_k = s.topK
  if (s.minP !== undefined) b.min_p = s.minP
  if (s.typicalP !== undefined) b.typical_p = s.typicalP
  if (s.repeatPenalty !== undefined) b.repeat_penalty = s.repeatPenalty
  if (s.repeatLastN !== undefined) b.repeat_last_n = s.repeatLastN
  if (s.presencePenalty !== undefined) b.presence_penalty = s.presencePenalty
  if (s.frequencyPenalty !== undefined) b.frequency_penalty = s.frequencyPenalty
  if (s.mirostat !== undefined) b.mirostat = s.mirostat
  if (s.mirostatTau !== undefined) b.mirostat_tau = s.mirostatTau
  if (s.mirostatEta !== undefined) b.mirostat_eta = s.mirostatEta
  if (s.dryMultiplier !== undefined) b.dry_multiplier = s.dryMultiplier
  if (s.dryBase !== undefined) b.dry_base = s.dryBase
  if (s.dryAllowedLength !== undefined) b.dry_allowed_length = s.dryAllowedLength
  if (s.seed !== undefined && s.seed >= 0) b.seed = s.seed // -1 = let the engine randomize
  return b
}

/** Pull the sampler knobs out of Settings for a generation call. */
export function samplerFromSettings(s: Settings): SamplerParams {
  return {
    topK: s.topK,
    minP: s.minP,
    typicalP: s.typicalP,
    repeatPenalty: s.repeatPenalty,
    repeatLastN: s.repeatLastN,
    presencePenalty: s.presencePenalty,
    frequencyPenalty: s.frequencyPenalty,
    mirostat: s.mirostat,
    mirostatTau: s.mirostatTau,
    mirostatEta: s.mirostatEta,
    dryMultiplier: s.dryMultiplier,
    dryBase: s.dryBase,
    dryAllowedLength: s.dryAllowedLength,
    seed: s.seed,
  }
}

/** One-shot yes/no vision classification: does the image match `question`? Used by the folder
 * image-finder. Non-streaming call to the engine's OpenAI-compatible endpoint. */
export async function classifyImage(baseUrl: string, dataUrl: string, question: string, signal?: AbortSignal): Promise<boolean> {
  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'vision',
      max_tokens: 5,
      temperature: 0,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: `Does this image show ${question}? Answer with only "yes" or "no".` },
            { type: 'image_url', image_url: { url: dataUrl } },
          ],
        },
      ],
    }),
    signal,
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const json = await resp.json()
  return String(json.choices?.[0]?.message?.content ?? '')
    .toLowerCase()
    .includes('yes')
}

/** Run the intent-classifier prompt through the loaded model (non-streaming, deterministic).
 * Returns the raw model text for intent.ts to parse — robust to stray prose. */
export async function runIntentClassifier(baseUrl: string, prompt: string, signal?: AbortSignal): Promise<string> {
  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'intent',
      max_tokens: 256,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal,
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const json = await resp.json()
  return String(json.choices?.[0]?.message?.content ?? '')
}

const EMOTION_LABELS = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'fearful', 'embarrassed', 'affectionate'] as const

/**
 * Ask the model what the CHARACTER is actually feeling right now — reading subtext and their
 * personality, NOT the prose's surface tone (a dry, guarded, or teasing voice isn't anger, and
 * flirtation often hides behind sharp words). This is what the keyword heuristic can't do: it reads
 * word choice, so a wry character reads as "angry". Returns one of the 8 emotion labels, or null if
 * the engine is unreachable / the answer is unusable (the caller keeps its heuristic guess).
 * Non-streaming, deterministic, capped to a couple of tokens.
 */
export async function classifyEmotion(
  baseUrl: string,
  character: { name?: string; personality?: string; description?: string },
  reply: string,
  signal?: AbortSignal,
): Promise<string | null> {
  const name = character.name?.trim() || 'the character'
  const persona = [character.personality, character.description].filter(Boolean).join(' — ').slice(0, 500)
  const prompt =
    `You label a roleplay character's current emotion for a portrait system.\n\n` +
    `CHARACTER: ${name}\n` +
    (persona ? `PERSONALITY: ${persona}\n` : '') +
    `\nTheir latest message:\n"""\n${reply.slice(0, 2000)}\n"""\n\n` +
    `What is ${name} actually FEELING right now — the expression they'd wear on their face? Read the ` +
    `subtext and their personality, NOT the writing style: a dry, guarded, clinical, cool, or teasing ` +
    `tone is not anger, and flirtation or affection often hides behind wry or sharp words.\n\n` +
    `Answer with ONLY one word from: ${EMOTION_LABELS.join(', ')}.`
  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'emotion', max_tokens: 8, temperature: 0, messages: [{ role: 'user', content: prompt }] }),
      signal,
    })
    if (!resp.ok) return null
    const json = await resp.json()
    const out = String(json.choices?.[0]?.message?.content ?? '').toLowerCase()
    return EMOTION_LABELS.find((k) => out.includes(k)) ?? null
  } catch {
    return null
  }
}

/**
 * Pick which portrait "look" (outfit/appearance set) the character currently has, by matching the
 * recent story against each set's name + description. Deliberately STICKY: it's told to keep the
 * current look unless the story clearly shows a wardrobe/appearance change ("put on", "changed into",
 * "now wearing", "took off"), so an ordinary reply doesn't flip the outfit. Text-only + deterministic
 * — no vision, no model swap. Returns the chosen set's id, or null to keep the current look.
 */
export async function classifyPortraitSet(
  baseUrl: string,
  character: { name?: string },
  sets: { id: string; name: string; description?: string }[],
  currentSetId: string | undefined,
  recentText: string,
  signal?: AbortSignal,
): Promise<string | null> {
  if (sets.length < 2) return null
  const name = character.name?.trim() || 'the character'
  const currentIdx = Math.max(0, sets.findIndex((s) => s.id === currentSetId))
  const list = sets
    .map((s, i) => `${i + 1}. ${s.name?.trim() || 'Untitled'}${s.description?.trim() ? ` — ${s.description.trim()}` : ''}`)
    .join('\n')
  const prompt =
    `You choose which visual LOOK a roleplay character currently has, for a portrait system.\n\n` +
    `CHARACTER: ${name}\n\nAVAILABLE LOOKS:\n${list}\n\n` +
    `CURRENTLY SHOWING: look ${currentIdx + 1} (${sets[currentIdx]?.name?.trim() || 'Untitled'})\n\n` +
    `Recent story:\n"""\n${recentText.slice(-1600)}\n"""\n\n` +
    `Which look is ${name} in RIGHT NOW? Only change from the current look if the story clearly shows ` +
    `them changing their clothes or appearance (put on, changed into, slipped into, now wearing, took ` +
    `off, undressed, transformed). If nothing clearly changed, keep the current look.\n\n` +
    `Answer with ONLY the number of the look.`
  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'intent', max_tokens: 6, temperature: 0, messages: [{ role: 'user', content: prompt }] }),
      signal,
    })
    if (!resp.ok) return null
    const json = await resp.json()
    const out = String(json.choices?.[0]?.message?.content ?? '')
    const n = parseInt(out.match(/\d+/)?.[0] ?? '', 10)
    if (!Number.isFinite(n) || n < 1 || n > sets.length) return null
    return sets[n - 1].id
  } catch {
    return null
  }
}

/**
 * Vision: describe a portrait's outfit/appearance in one concise phrase, to fill a set's description
 * (which drives auto-switch). Requires the vision model to be loaded (set_vision_mode(true) first).
 * Returns a trimmed phrase, or '' if the engine can't answer.
 */
export async function describePortrait(baseUrl: string, dataUrl: string, name: string, signal?: AbortSignal): Promise<string> {
  const who = name?.trim() || 'the character'
  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'vision',
        max_tokens: 60,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  `In ONE short phrase, describe ${who}'s outfit and overall appearance in this image — ` +
                  `focus on clothing, hair, and any striking visual details. No preamble, no sentence, just the phrase.`,
              },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
      signal,
    })
    if (!resp.ok) return ''
    const json = await resp.json()
    return String(json.choices?.[0]?.message?.content ?? '')
      .replace(/^["'\s]+|["'\s]+$/g, '')
      .replace(/\s+/g, ' ')
      .slice(0, 200)
  } catch {
    return ''
  }
}

/**
 * Vision: tag one smart-folder portrait with short keywords (emotion, outfit, hair, pose, striking
 * details) for the character's portrait index. Requires the vision model to be loaded
 * (set_vision_mode(true) first). Returns a cleaned comma-keyword string, or '' if unusable.
 */
export async function tagPortrait(baseUrl: string, dataUrl: string, name: string, signal?: AbortSignal): Promise<string> {
  const who = name?.trim() || 'the character'
  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'vision',
        max_tokens: 80,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text:
                  `You tag character portraits for an index. List 8-15 short comma-separated keywords for this ` +
                  `image of ${who}: their emotion/expression, outfit/clothing, hair, pose, and any striking visual ` +
                  `details. Lowercase keywords only — no sentences, no numbering.`,
              },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
      signal,
    })
    if (!resp.ok) return ''
    const json = await resp.json()
    return String(json.choices?.[0]?.message?.content ?? '')
      .replace(/[\n\r]+/g, ', ')
      .replace(/^["'\s,]+|["'\s,]+$/g, '')
      .replace(/\s+/g, ' ')
      .replace(/(, )+/g, ', ')
      .slice(0, 240)
  } catch {
    return ''
  }
}

/**
 * Pick the best portrait from a character's analyzed smart folder for the current scene — one
 * deterministic text call over the stored keyword index (no vision, no model swap at runtime).
 * Covers emotion, outfit, AND pose in a single pick; told to keep the current outfit unless the
 * story clearly changed it. Returns the chosen filename, or null to keep what's showing.
 */
export async function pickPortrait(
  baseUrl: string,
  character: { name?: string },
  entries: { file: string; tags: string }[],
  currentFile: string | undefined,
  recentText: string,
  signal?: AbortSignal,
): Promise<string | null> {
  if (entries.length < 2) return null
  const name = character.name?.trim() || 'the character'
  const list = entries.map((e, i) => `${i + 1}. ${e.file} — ${e.tags}`).join('\n')
  const curIdx = currentFile ? entries.findIndex((e) => e.file === currentFile) : -1
  const prompt =
    `You choose the best portrait of a roleplay character for the current scene.\n\n` +
    `CHARACTER: ${name}\n\nPORTRAITS:\n${list}\n\n` +
    (curIdx >= 0 ? `CURRENTLY SHOWING: ${curIdx + 1} (${entries[curIdx].file})\n\n` : '') +
    `Recent story:\n"""\n${recentText.slice(-1600)}\n"""\n\n` +
    `Pick the portrait that best matches ${name}'s emotion, outfit, and pose RIGHT NOW. Keep the ` +
    `current outfit unless the story clearly shows them changing clothes or appearance. The expression ` +
    `should match what ${name} is actually FEELING — read the subtext and their personality, not the ` +
    `writing style: a dry, guarded, or teasing voice is not anger.\n\n` +
    `Answer with ONLY the number of the portrait.`
  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'intent', max_tokens: 6, temperature: 0, messages: [{ role: 'user', content: prompt }] }),
      signal,
    })
    if (!resp.ok) return null
    const json = await resp.json()
    const out = String(json.choices?.[0]?.message?.content ?? '')
    const n = parseInt(out.match(/\d+/)?.[0] ?? '', 10)
    if (!Number.isFinite(n) || n < 1 || n > entries.length) return null
    return entries[n - 1].file
  } catch {
    return null
  }
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

/** Three-state engine readiness: down (not up yet) | loading (model loading) | ready. */
export async function getEngineStatus(baseUrl: string): Promise<'down' | 'loading' | 'ready'> {
  try {
    const r = await fetch(`${nativeRoot(baseUrl)}/health`)
    return r.ok ? 'ready' : 'loading' // llama.cpp returns 503 while still loading the model
  } catch {
    return 'down'
  }
}

const PROOFREAD_SYSTEM =
  'You are a meticulous copy editor. Fix ONLY spelling, grammar, and punctuation errors in the text. ' +
  'Do NOT rephrase, reword, add, remove, summarize, translate, or change meaning, tone, or voice. ' +
  'Preserve all formatting EXACTLY: *asterisk actions*, "quoted speech", line breaks, markdown, emoji, and any ' +
  '"Name:" speaker prefixes. Output only the corrected text — no preamble, no commentary, no surrounding quotes.'

/** Re-run text through the model to fix spelling/grammar only, preserving content & formatting. */
export async function proofread(baseUrl: string, model: string, text: string, signal?: AbortSignal): Promise<string> {
  const { content } = await streamChatNative({
    baseUrl,
    model,
    messages: [
      { role: 'system', content: PROOFREAD_SYSTEM },
      { role: 'user', content: text },
    ],
    temperature: 0.2,
    topP: 0.9,
    think: false,
    signal,
  })
  return content.trim()
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
  Object.assign(body, samplerBody(opts.sampler))

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
  sampler?: SamplerParams
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
      ...samplerBody(opts.sampler),
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
