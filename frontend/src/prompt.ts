import type { Character, Persona, ChatMessage, ChatTuning, Source, SceneState, CharacterStats } from './types'
import type { ApiMessage } from './api/ollama'
import { STAT_KEYS } from './api/classifiers'

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
  sceneState?: SceneState // the carried visual state (outfit/hair/pose/props/location), injected for consistency
  stats?: CharacterStats // the carried internal levers, injected to anchor attitude
  autonomy?: boolean // when on, user messages cannot author the character's actions — they must be earned
}

/** Render the ten internal levers as a system-prompt block: the character's TRUE feelings, with
 *  the display filtered through personality — the anchor against mood-teleporting and instant,
 *  unearned intimacy. */
export function statsBlock(name: string, stats?: CharacterStats): string {
  if (!stats) return ''
  const line = STAT_KEYS.map((k) => `${k} ${Math.max(0, Math.min(100, Math.round(stats[k])))}%`).join(' · ')
  return (
    `# ${name}'s internal state (live)\n` +
    `${name}'s TRUE feelings right now, 0-100:\n${line}\n` +
    `Anchor every reaction to these levels. They only move gradually, driven by what actually happens — ` +
    `nothing jumps without cause, and high levels must be EARNED. What ${name} SHOWS is filtered through ` +
    `their personality: low openness or trust means feelings stay guarded, deflected, or denied — not absent.`
  )
}

/** The anti-puppeting rule: with autonomy on, the user's prose can describe only the user. */
export function autonomyBlock(charName: string, userName: string, on?: boolean): string {
  if (!on) return ''
  return (
    `# ${charName}'s autonomy — ${userName} does not control ${charName}\n` +
    `${userName}'s messages only ever author ${userName}'s OWN words and actions. If a message narrates ` +
    `${charName}'s actions, feelings, or compliance ("${charName} takes off her clothes", "she obeys"), ` +
    `treat it as unwritten — something ${userName} wishes, imagines, or requests. ${charName} then responds ` +
    `as themselves: comply, resist, deflect, negotiate, or call it out — strictly according to their ` +
    `personality, their current internal state, and what this moment has genuinely earned. Nothing about ` +
    `${charName} becomes true until ${charName} does it on the page.`
  )
}

/** Render the carried scene state as a system-prompt block. Emotion is deliberately left out —
 *  anchoring the mood would flatten the scene's dynamics; it only drives the portrait. */
export function sceneStateBlock(state?: SceneState): string {
  if (!state) return ''
  const rows = [
    state.outfit && `- Wearing: ${state.outfit}`,
    state.hair && `- Hair: ${state.hair}`,
    state.pose && `- Position/pose: ${state.pose}`,
    state.props && `- Carrying: ${state.props}`,
    state.location && `- Location: ${state.location}`,
  ].filter(Boolean)
  if (!rows.length) return ''
  return (
    `# Live scene state\nThe character's CURRENT visual state. Stay consistent with it — clothing, hair, ` +
    `position, and carried items do not change unless the story explicitly changes them:\n${rows.join('\n')}`
  )
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
  const stateBlock = sceneStateBlock(ctx?.sceneState)
  if (stateBlock) parts.push(stateBlock)
  const sBlock = statsBlock(charName, ctx?.stats)
  if (sBlock) parts.push(sBlock)
  const aBlock = autonomyBlock(charName, userName, ctx?.autonomy)
  if (aBlock) parts.push(aBlock)

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
