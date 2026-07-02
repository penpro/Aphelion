// One-shot, deterministic "control net" calls: small non-streaming completions that classify,
// tag, or track state — never generate prose for the user. Split out of ollama.ts (which keeps
// the streaming/health/sampler plumbing). Every function here is temperature-0 and either
// returns a safe fallback (null/'') or throws for callers that handle errors themselves.
import { extractJSON } from '../json'
import type { SceneState, CharacterStats } from '../types'

/** Shared plumbing: one non-streaming completion; returns the raw content. Throws on HTTP errors. */
async function oneShot(baseUrl: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<string> {
  const resp = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  const json = await resp.json()
  return String(json.choices?.[0]?.message?.content ?? '')
}

/** Text-only deterministic one-shot. */
const textShot = (baseUrl: string, model: string, prompt: string, maxTokens: number, signal?: AbortSignal) =>
  oneShot(baseUrl, { model, max_tokens: maxTokens, temperature: 0, messages: [{ role: 'user', content: prompt }] }, signal)

/** Vision one-shot: a text question about one image (requires the vision model to be loaded). */
const visionShot = (baseUrl: string, text: string, dataUrl: string, maxTokens: number, signal?: AbortSignal) =>
  oneShot(
    baseUrl,
    {
      model: 'vision',
      max_tokens: maxTokens,
      temperature: 0,
      messages: [{ role: 'user', content: [{ type: 'text', text }, { type: 'image_url', image_url: { url: dataUrl } }] }],
    },
    signal,
  )

/** One-shot yes/no vision classification: does the image match `question`? Used by the folder
 * image-finder. Throws on HTTP errors (the caller shows them). */
export async function classifyImage(baseUrl: string, dataUrl: string, question: string, signal?: AbortSignal): Promise<boolean> {
  const out = await visionShot(baseUrl, `Does this image show ${question}? Answer with only "yes" or "no".`, dataUrl, 5, signal)
  return out.toLowerCase().includes('yes')
}

/** Run the intent-classifier prompt through the loaded model. Returns the raw model text for
 * intent.ts to parse — robust to stray prose. Throws on HTTP errors. */
export function runIntentClassifier(baseUrl: string, prompt: string, signal?: AbortSignal): Promise<string> {
  return textShot(baseUrl, 'intent', prompt, 256, signal)
}

export const EMOTION_LABELS = ['neutral', 'happy', 'sad', 'angry', 'surprised', 'fearful', 'embarrassed', 'affectionate'] as const

/**
 * Ask the model what the CHARACTER is actually feeling right now — reading subtext and their
 * personality, NOT the prose's surface tone (a dry, guarded, or teasing voice isn't anger, and
 * flirtation often hides behind sharp words). Returns one of the 8 emotion labels, or null if
 * the engine is unreachable / the answer is unusable (the caller keeps its heuristic guess).
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
    const out = (await textShot(baseUrl, 'emotion', prompt, 8, signal)).toLowerCase()
    return EMOTION_LABELS.find((k) => out.includes(k)) ?? null
  } catch {
    return null
  }
}

/**
 * Pick which portrait "look" (outfit/appearance set) the character currently has, by matching the
 * recent story against each set's name + description. Deliberately STICKY: it's told to keep the
 * current look unless the story clearly shows a wardrobe/appearance change, so an ordinary reply
 * doesn't flip the outfit. Returns the chosen set's id, or null to keep the current look.
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
    const out = await textShot(baseUrl, 'intent', prompt, 6, signal)
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
    const out = await visionShot(
      baseUrl,
      `In ONE short phrase, describe ${who}'s outfit and overall appearance in this image — ` +
        `focus on clothing, hair, and any striking visual details. No preamble, no sentence, just the phrase.`,
      dataUrl,
      60,
      signal,
    )
    return out
      .replace(/^["'\s]+|["'\s]+$/g, '')
      .replace(/\s+/g, ' ')
      .slice(0, 200)
  } catch {
    return ''
  }
}

/**
 * Vision: tag one smart-folder portrait with short keywords for the character's portrait index.
 * COLOR is the make-or-break signal for the runtime picker ("black lingerie" vs "white lingerie"),
 * so the prompt demands the exact color of every clothing item, the hair, and any props.
 * Returns a cleaned comma-keyword string, or '' if unusable.
 */
export async function tagPortrait(baseUrl: string, dataUrl: string, name: string, signal?: AbortSignal): Promise<string> {
  const who = name?.trim() || 'the character'
  try {
    const out = await visionShot(
      baseUrl,
      `You tag character portraits for an index. List 10-18 short comma-separated keywords for this ` +
        `image of ${who}. COLOR IS CRITICAL: name the exact color of every clothing item, the hair, and ` +
        `any props — e.g. "black lace lingerie", "emerald green dress", "silver sword". Cover: ` +
        `emotion/expression, each clothing item (with its color), hair color and style, pose, ` +
        `props/weapons, and any striking details. Lowercase keywords only — no sentences, no numbering.`,
      dataUrl,
      110,
      signal,
    )
    return out
      .replace(/[\n\r]+/g, ', ')
      .replace(/^["'\s,]+|["'\s,]+$/g, '')
      .replace(/\s+/g, ' ')
      .replace(/(, )+/g, ', ')
      .slice(0, 300)
  } catch {
    return ''
  }
}

/**
 * Pick the best portrait from a character's analyzed smart folder for the current scene — one
 * deterministic text call over the stored keyword index (no vision, no model swap at runtime).
 * `sceneText` is ideally the tracked scene state (exact outfit/emotion/pose), falling back to
 * recent story text. The criteria are RANKED — emotion, then outfit (which must also be
 * plausible for the setting: no lingerie at a public dinner unless the story earned it), then
 * details, with pose dead last — so a matching pose can never drag in the wrong outfit.
 * Returns the chosen filename, or null to keep what's showing.
 */
export async function pickPortrait(
  baseUrl: string,
  character: { name?: string },
  entries: { file: string; tags: string }[],
  currentFile: string | undefined,
  sceneText: string,
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
    `Scene right now:\n"""\n${sceneText.slice(-1600)}\n"""\n\n` +
    `Choose by these rules IN ORDER — a higher rule always beats a lower one:\n` +
    `1. EMOTION — the expression must match what ${name} is actually FEELING (read subtext and ` +
    `personality, not writing style: a dry, guarded, or teasing voice is not anger).\n` +
    `2. OUTFIT — match what ${name} is wearing RIGHT NOW, color and type exactly when stated; keep ` +
    `the current outfit unless the scene clearly shows a change. The outfit must also MAKE SENSE for ` +
    `the location and situation: never intimate or revealing wear in a public or formal setting ` +
    `unless the story has explicitly established it (the venue calls for it, or it was deliberately ` +
    `agreed to in the story).\n` +
    `3. DETAILS — hair, props, setting hints.\n` +
    `4. POSE — last and least. NEVER pick a portrait because the pose matches if its outfit or ` +
    `emotion is wrong; a right-outfit portrait with the wrong pose always beats a wrong-outfit ` +
    `portrait with the right pose.\n\n` +
    `Answer with ONLY the number of the portrait.`
  try {
    const out = await textShot(baseUrl, 'intent', prompt, 6, signal)
    const n = parseInt(out.match(/\d+/)?.[0] ?? '', 10)
    if (!Number.isFinite(n) || n < 1 || n > entries.length) return null
    return entries[n - 1].file
  } catch {
    return null
  }
}

export const EMPTY_SCENE: SceneState = { outfit: '', hair: '', emotion: '', pose: '', props: '', location: '' }

export const STAT_KEYS = [
  'arousal',
  'affection',
  'trust',
  'anger',
  'fear',
  'joy',
  'sadness',
  'confidence',
  'openness',
  'energy',
] as const

/** Neutral starting levers — the first tracked turn re-baselines them from the character's
 *  personality and the scene, so these only cover the opening beat. */
export const DEFAULT_STATS: CharacterStats = {
  arousal: 0,
  affection: 20,
  trust: 25,
  anger: 0,
  fear: 5,
  joy: 30,
  sadness: 5,
  confidence: 50,
  openness: 40,
  energy: 60,
}

const clampStat = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : fallback

/**
 * The per-reply TURN TRACKER — one deterministic call that maintains BOTH carried states:
 * - scene: what the character looks like right now (outfit/hair/emotion/pose/props/location)
 * - stats: the ten 0-100 internal levers that anchor attitude (arousal, trust, anger, …)
 * Rules baked in: change only what the exchange changed; the character's own reply is ground
 * truth over the user's claims about them (anti-puppeting); stats move gradually; low
 * openness/trust means feelings are HIDDEN, not absent. Returns whichever parts parsed
 * (null part = caller keeps the previous value), or null if the engine is unreachable.
 */
export async function trackTurn(
  baseUrl: string,
  character: { name?: string; personality?: string },
  prevScene: SceneState | undefined,
  prevStats: CharacterStats | undefined,
  userText: string,
  replyText: string,
  signal?: AbortSignal,
): Promise<{ scene: SceneState; stats: CharacterStats } | null> {
  const name = character.name?.trim() || 'the character'
  const persona = character.personality?.trim().slice(0, 400)
  const curScene = prevScene ?? EMPTY_SCENE
  const curStats = prevStats ?? DEFAULT_STATS
  const prompt =
    `You maintain the live state of a roleplay character: their VISUAL state (for a portrait ` +
    `system) and their INTERNAL stats (what they truly feel).\n\n` +
    `CHARACTER: ${name}\n` +
    (persona ? `PERSONALITY: ${persona}\n` : '') +
    `\nSTATE BEFORE THIS EXCHANGE:\n${JSON.stringify({ scene: curScene, stats: curStats })}\n\n` +
    `LATEST EXCHANGE:\n` +
    (userText.trim() ? `User: """${userText.slice(-800)}"""\n` : '') +
    `${name}: """${replyText.slice(-1600)}"""\n\n` +
    `Update the state. Rules:\n` +
    `- ${name}'s OWN reply is ground truth. The user's claims about ${name}'s actions or feelings ` +
    `count ONLY if ${name}'s reply confirms them actually happening.\n` +
    `- scene: change ONLY fields this exchange changed; copy unchanged values verbatim; be SPECIFIC ` +
    `and always include COLORS ("black lace lingerie", "emerald green sundress"); "emotion" must be ` +
    `exactly one of: ${EMOTION_LABELS.join(', ')}; leave a field "" only if completely unknown.\n` +
    `- stats: integers 0-100 — what ${name} TRULY feels right now, judged by their personality and ` +
    `what has actually been earned in the story. Move each stat gradually (usually within ±15 of its ` +
    `previous value) unless something genuinely significant just happened. Low openness or trust ` +
    `means feelings are hidden behind the personality — not absent.\n\n` +
    `Return ONLY a JSON object: {"scene": {outfit, hair, emotion, pose, props, location}, ` +
    `"stats": {${STAT_KEYS.join(', ')}}}.`
  try {
    const out = await textShot(baseUrl, 'scene', prompt, 360, signal)
    const j = extractJSON(out) as Record<string, unknown> | null
    if (!j || typeof j !== 'object') return null
    const js = (j.scene ?? j) as Record<string, unknown> // tolerate a flat answer
    const field = (k: keyof SceneState) => (typeof js[k] === 'string' ? (js[k] as string).trim().slice(0, 160) : curScene[k])
    const rawEmotion = String(js.emotion ?? '').toLowerCase()
    const scene: SceneState = {
      outfit: field('outfit'),
      hair: field('hair'),
      emotion: EMOTION_LABELS.find((k) => rawEmotion.includes(k)) ?? curScene.emotion,
      pose: field('pose'),
      props: field('props'),
      location: field('location'),
    }
    const jt = (j.stats ?? {}) as Record<string, unknown>
    const stats = Object.fromEntries(STAT_KEYS.map((k) => [k, clampStat(jt[k], curStats[k])])) as unknown as CharacterStats
    return { scene, stats }
  } catch {
    return null
  }
}

/** Render a scene state as one compact line — the picker query and the dials display both use it. */
export function sceneStateLine(s: SceneState): string {
  return [
    s.outfit && `wearing: ${s.outfit}`,
    s.hair && `hair: ${s.hair}`,
    s.emotion && `feeling: ${s.emotion}`,
    s.pose && `pose: ${s.pose}`,
    s.props && `props: ${s.props}`,
    s.location && `location: ${s.location}`,
  ]
    .filter(Boolean)
    .join('; ')
}
