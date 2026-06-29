import type { Character, Persona, ChatMessage, ChatTuning, Source } from './types'
import type { ApiMessage } from './api/ollama'

/** Render attached reference docs into a context block. */
export function sourcesBlock(sources?: Source[]): string {
  if (!sources?.length) return ''
  const body = sources
    .filter((s) => s.text.trim())
    .map((s) => `### ${s.name}\n${s.text.trim()}`)
    .join('\n\n')
  if (!body) return ''
  return (
    `# Reference material\nDraw on the following for style, voice, lore, and facts. Treat it as ` +
    `background source material — absorb its flavor; don't quote it verbatim unless apt.\n\n${body}`
  )
}

/** SillyTavern-style macro substitution. */
export function substituteMacros(text: string, charName: string, userName: string): string {
  if (!text) return ''
  return text
    .replace(/\{\{char\}\}/gi, charName)
    .replace(/\{\{user\}\}/gi, userName)
    .replace(/<BOT>/g, charName)
    .replace(/<USER>/g, userName)
}

const INTENSITY = [
  '',
  'wholesome — keep it tame, no on-page sex or graphic violence',
  'mild',
  'suggestive — imply heat and danger without explicit detail',
  'mature and steamy — sensual and intense, written with craft',
  'fully explicit and uncensored — do not fade to black',
]

function tuningDirectives(t: ChatTuning): string {
  const prose =
    t.prose >= 70
      ? 'Favor description, narration, and interiority; keep dialogue sparser.'
      : t.prose <= 30
        ? 'Favor dialogue and quick back-and-forth; keep narration light.'
        : 'Balance dialogue and description.'
  const len =
    t.length === 'short'
      ? 'Keep replies short — about one tight paragraph.'
      : t.length === 'long'
        ? 'Write long, detailed replies — several full paragraphs.'
        : 'Write moderate replies — roughly one to three paragraphs.'
  return `Response style:\n- ${prose}\n- ${len}\n- Content intensity: ${INTENSITY[t.intensity] ?? 'mild'}.`
}

export interface SceneCtx {
  scenePrompt?: string
  tuning?: ChatTuning
  mutedIds?: string[]
  sources?: Source[]
  summary?: string // rolling "story so far" memory, kept in context across the whole chat
}

function charBlock(c: Character, muted: boolean): string {
  const lines: string[] = [
    `## ${c.name}${muted ? ' — SILENT (present in the scene but do NOT voice or speak as them; others may still reference them)' : ''}`,
  ]
  if (c.systemPrompt?.trim()) lines.push(c.systemPrompt.trim())
  if (c.description?.trim()) lines.push(`Description: ${c.description.trim()}`)
  if (c.personality?.trim()) lines.push(`Personality: ${c.personality.trim()}`)
  if (c.scenario?.trim()) lines.push(`Backdrop: ${c.scenario.trim()}`)
  if (c.exampleDialogue?.trim()) lines.push(`Example dialogue:\n${c.exampleDialogue.trim()}`)
  return lines.join('\n')
}

/** Assemble the system prompt from the full cast + user persona + chat scene. */
export function buildSystemPrompt(cast: Character[], persona: Persona, ctx?: SceneCtx): string {
  const charName = cast[0]?.name || 'Character'
  const userName = persona.name || 'User'
  const muted = new Set(ctx?.mutedIds ?? [])
  const isGroup = cast.length > 1
  const parts: string[] = []

  if (isGroup) {
    const voiced = cast.filter((c) => !muted.has(c.id)).map((c) => c.name)
    parts.push(
      `You are the narrator and voice of an immersive, collaborative GROUP roleplay scene with ${userName}. ` +
        `Voice these characters — ${voiced.join(', ') || charName} — and narrate the scene; let them interact, ` +
        `talk over one another, and react in a single flowing scene. Never speak or act for ${userName}, and do not describe yourself as an AI.`,
    )
  } else {
    parts.push(
      `You are ${charName} in an immersive, collaborative roleplay with ${userName}. ` +
        `Stay fully in character as ${charName}: write vivid, in-character prose, narrate ${charName}'s actions, ` +
        `speech, and feelings, and advance the scene. Never break character, never speak or act for ${userName}, and do not describe yourself as an AI.`,
    )
  }

  for (const c of cast) parts.push(charBlock(c, muted.has(c.id)))

  if (persona.description?.trim()) parts.push(`## ${userName} (the user)\n${persona.description.trim()}`)
  const srcBlock = sourcesBlock(ctx?.sources)
  if (srcBlock) parts.push(srcBlock)
  if (ctx?.summary?.trim())
    parts.push(
      `# Story so far (memory)\nA condensed record of earlier events in this scene that are no longer shown verbatim. ` +
        `Treat it as established history and stay fully consistent with it.\n\n${ctx.summary.trim()}`,
    )
  if (ctx?.scenePrompt?.trim()) parts.push(`# Current scene\n${ctx.scenePrompt.trim()}`)

  if (isGroup) {
    parts.push(
      `Format: begin each character's dialogue/action with their name in bold — e.g. **${charName}:** "..." *action*. ` +
        `Use plain paragraphs for narration. In a single reply, voice whichever character(s) the moment calls for (one or several), ` +
        `but never ${userName} and never a SILENT character.`,
    )
  }
  if (ctx?.tuning) parts.push(tuningDirectives(ctx.tuning))

  return substituteMacros(parts.join('\n\n'), charName, userName)
}

// Rough token estimate for English prose (~3.5 chars/token; we slightly
// overestimate so trimming stays on the safe side of the real context limit).
const CHARS_PER_TOKEN = 3.5
export const estTokens = (s: string): number => Math.ceil((s?.length ?? 0) / CHARS_PER_TOKEN)

export interface BudgetOpts {
  maxContextTokens?: number // the model's num_ctx; 0/undefined disables trimming
  reserveTokens?: number // tokens to leave free for the model's reply
}

/**
 * Build the full OpenAI-style message array for a generation.
 *
 * Rolling context: the system prompt (cast definitions, scene, sources) is ALWAYS
 * kept; the message history is trimmed from the oldest end so the prompt fits inside
 * (num_ctx − system − reply reserve). This keeps a long chat from filling the context
 * and stalling — the oldest turns scroll out of memory while the characters/scene stay.
 */
export function buildApiMessages(
  cast: Character[],
  persona: Persona,
  messages: ChatMessage[],
  ctx?: SceneCtx,
  budget?: BudgetOpts,
): ApiMessage[] {
  const charName = cast[0]?.name || 'Character'
  const userName = persona.name || 'User'
  const system = buildSystemPrompt(cast, persona, ctx)
  const systemMsg: ApiMessage = { role: 'system', content: system }

  const turns: ApiMessage[] = []
  for (const m of messages) {
    if (m.role === 'system' || m.error) continue
    turns.push({ role: m.role, content: substituteMacros(m.content, charName, userName) })
  }

  const max = budget?.maxContextTokens ?? 0
  if (max <= 0) return [systemMsg, ...turns] // no budget given → no trimming

  const reserve = budget?.reserveTokens ?? 2048
  let remaining = max - estTokens(system) - reserve
  const kept: ApiMessage[] = []
  // Walk newest → oldest, keeping turns until the budget runs out (always keep
  // at least the most recent turn so generation never starves).
  for (let i = turns.length - 1; i >= 0; i--) {
    const c = turns[i].content
    const cost = estTokens(typeof c === 'string' ? c : '') + 8 // small per-message framing overhead
    if (remaining - cost < 0 && kept.length > 0) break
    remaining -= cost
    kept.unshift(turns[i])
  }
  return [systemMsg, ...kept]
}
