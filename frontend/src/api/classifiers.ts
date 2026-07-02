// One-shot, deterministic "control net" calls: small non-streaming completions that classify,
// tag, or track state — never generate prose for the user. Split out of ollama.ts (which keeps
// the streaming/health/sampler plumbing). Every function here is temperature-0 and either
// returns a safe fallback (null/'') or throws for callers that handle errors themselves.
import { extractJSON } from '../json'
import type { SceneState } from '../types'

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
 * recent story text. Sticky on outfit; expressive on emotion. Returns the chosen filename, or
 * null to keep what's showing.
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
    `Pick the portrait that best matches ${name}'s emotion, outfit, and pose RIGHT NOW — match the ` +
    `outfit's COLOR and type exactly when stated. Keep the current outfit unless the scene clearly ` +
    `shows them changing clothes or appearance. The expression should match what ${name} is actually ` +
    `FEELING — read the subtext and their personality, not the writing style: a dry, guarded, or ` +
    `teasing voice is not anger.\n\n` +
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

/**
 * Maintain the chat's carried SCENE STATE — the deliberate record of what the character looks like
 * right now (outfit, hair, emotion, pose, props, location). One deterministic call per finished
 * reply updates only the fields the exchange changed; everything else is carried verbatim. This is
 * the "deliberately carried, not sniffed" state: it's injected into the system prompt so the story
 * stays consistent, and it's what the portrait picker queries. Returns the new state, or null if
 * the engine is unreachable / the answer is unusable (the caller keeps the previous state).
 */
export async function updateSceneState(
  baseUrl: string,
  character: { name?: string },
  prev: SceneState | undefined,
  userText: string,
  replyText: string,
  signal?: AbortSignal,
): Promise<SceneState | null> {
  const name = character.name?.trim() || 'the character'
  const cur = prev ?? EMPTY_SCENE
  const prompt =
    `You maintain the CURRENT VISUAL STATE of a roleplay character for a portrait system. ` +
    `Track what ${name} looks like RIGHT NOW.\n\n` +
    `STATE BEFORE THIS EXCHANGE:\n${JSON.stringify(cur)}\n\n` +
    `LATEST EXCHANGE:\n` +
    (userText.trim() ? `User: """${userText.slice(-800)}"""\n` : '') +
    `${name}: """${replyText.slice(-1600)}"""\n\n` +
    `Update the state. Rules:\n` +
    `- Change ONLY fields this exchange actually changed; copy unchanged values verbatim.\n` +
    `- Be SPECIFIC and always include COLORS ("black lace lingerie", "emerald green sundress").\n` +
    `- "emotion" must be exactly one of: ${EMOTION_LABELS.join(', ')} — what ${name} actually FEELS ` +
    `(subtext and personality, not writing style; a dry or teasing voice is not anger).\n` +
    `- Leave a field "" only if it is still completely unknown.\n\n` +
    `Return ONLY a JSON object with the string keys: outfit, hair, emotion, pose, props, location.`
  try {
    const out = await textShot(baseUrl, 'scene', prompt, 220, signal)
    const j = extractJSON(out) as Record<string, unknown> | null
    if (!j || typeof j !== 'object') return null
    const field = (k: keyof SceneState) => (typeof j[k] === 'string' ? (j[k] as string).trim().slice(0, 160) : cur[k])
    const rawEmotion = String(j.emotion ?? '').toLowerCase()
    return {
      outfit: field('outfit'),
      hair: field('hair'),
      emotion: EMOTION_LABELS.find((k) => rawEmotion.includes(k)) ?? cur.emotion,
      pose: field('pose'),
      props: field('props'),
      location: field('location'),
    }
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
