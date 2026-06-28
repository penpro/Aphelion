import type { Settings, ChatMessage } from './types'
import { streamChatNative, type ApiMessage } from './api/ollama'
import { estTokens, substituteMacros } from './prompt'

// Fold older messages into memory once the live (unsummarized) tail exceeds this.
export const LIVE_WINDOW_TOKENS = 25000
// Always keep at least this much recent dialogue verbatim (never summarized).
export const KEEP_RECENT_TOKENS = 6000
// Compact the running memory once it grows past this.
export const SUMMARY_CAP_TOKENS = 2500

// Same clamp the chat uses, so summarization runs at the same num_ctx and never
// forces the model to reload between a chat turn and a memory pass.
const clampCtx = (n: number): number => Math.min(Math.max(n || 8192, 2048), 131072)

async function complete(settings: Settings, system: string, user: string, signal?: AbortSignal): Promise<string> {
  const messages: ApiMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
  const { content } = await streamChatNative({
    baseUrl: settings.baseUrl,
    model: settings.model,
    messages,
    temperature: 0.3, // low variance — faithful facts, not creativity
    topP: 0.9,
    think: false, // no reasoning trace; keep summarization fast
    numCtx: clampCtx(settings.contextLength),
    signal,
  })
  return content.trim()
}

/** Distill a chunk of older roleplay messages into a terse factual memory (~250 tokens). */
export async function distillMessages(opts: {
  chunk: ChatMessage[]
  castNames: string[]
  userName: string
  settings: Settings
  signal?: AbortSignal
}): Promise<string> {
  const char = opts.castNames[0] ?? 'Character'
  const transcript = opts.chunk
    .filter((m) => !m.error && m.content.trim())
    .map((m) => `${m.role === 'user' ? opts.userName : char}: ${substituteMacros(m.content, char, opts.userName)}`)
    .join('\n')
  const system =
    'You maintain a running memory for a long, ongoing roleplay. Read the transcript excerpt and distill ONLY what must ' +
    'be remembered later: plot events, revelations and twists, decisions, changes in relationships or status, new facts ' +
    'about people and places, promises, injuries, acquired items, and unresolved threads. Write terse factual bullet ' +
    'points in past tense — no prose, no quotes, no atmosphere — about 180 words total. Omit anything trivial. Output ONLY the bullets.'
  const user = `Transcript excerpt:\n\n${transcript || '(empty)'}\n\nDistill the lasting memory.`
  return complete(opts.settings, system, user, opts.signal)
}

/** Compress a running memory that has grown too large, keeping only what still matters. */
export async function compactSummary(opts: { summary: string; settings: Settings; signal?: AbortSignal }): Promise<string> {
  const system =
    'You compress the running memory of a long roleplay. Merge duplicates, drop superseded or trivial details, and keep ' +
    'only the facts, relationships, reveals, and unresolved threads that still matter going forward. Keep it terse factual ' +
    'bullet points, roughly half the length, ordered to read clearly. Output ONLY the compressed memory.'
  const user = `Current memory:\n\n${opts.summary}\n\nCompress it.`
  return complete(opts.settings, system, user, opts.signal)
}
