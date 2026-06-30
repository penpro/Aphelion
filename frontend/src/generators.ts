import type { Character, Persona, Settings, BeatType, StoryDials, POV, Source } from './types'
import { streamChat, type ApiMessage } from './api/ollama'
import { extractJSON } from './json'
import { sourcesBlock } from './prompt'

const PALETTE = ['#7c5cff', '#3fb6a8', '#ff6b8b', '#f5a623', '#4a90e2', '#9b59b6', '#2ecc71', '#e74c3c']

export function randomColor(): string {
  return PALETTE[Math.floor(Math.random() * PALETTE.length)]
}

/** One non-streamed completion; returns the answer content (reasoning discarded). */
async function complete(settings: Settings, messages: ApiMessage[], signal?: AbortSignal): Promise<string> {
  const { content } = await streamChat({
    baseUrl: settings.baseUrl,
    model: settings.model,
    messages,
    temperature: settings.temperature,
    topP: settings.topP,
    maxTokens: 0, // reasoning model: never cap, or content comes back empty
    signal,
  })
  return content
}

// ----------------------------- Document generation (Typst → PDF) -----------------------------

const TYPST_SYSTEM = `You are a document-authoring engine. You write clean, professional documents in TYPST markup and output ONLY the Typst source — no explanations, no commentary, and no markdown code fences.

TYPST QUICK REFERENCE (use only what the document needs):
• Headings: "= Title" (h1), "== Section" (h2), "=== Subsection" (h3)
• Emphasis: *bold*, _italic_
• Lists: "- item" for bullets, "+ item" for numbered; indent nested items by two spaces
• Paragraph break: a blank line. Forced line break: end the line with a single backslash.
• Tables: #table(columns: 3, [A], [B], [C], [1], [2], [3])
• Inline math: $E = m c^2$ . Display math (keep the surrounding spaces): $ sum_(i=1)^n i = (n (n+1)) / 2 $
• Quote block: #quote(block: true)[ ... ]
• Page break: #pagebreak() . Horizontal rule: #line(length: 100%)
• Accent color on text: #text(fill: rgb("#5EEAD4"))[ ... ]

ALWAYS begin the document with exactly this preamble, then a title heading and the content:

#set page(margin: 2.2cm, numbering: "1")
#set text(font: "New Computer Modern", size: 11pt)
#set par(justify: true, leading: 0.72em)
#set heading(numbering: none)
#show heading: set text(fill: rgb("#241152"))

RULES:
• Output must be valid, self-contained Typst that compiles with NO external files, fonts, or images.
• Never use #image(...), #import, #include, or read any external path.
• Give the document real structure: a clear title ("= ..."), sections, and lists / tables / math where they help.
• Be accurate to the request and to any reference material. Do not attribute invented facts to the references.
• Output ONLY the Typst source, starting with the preamble above — no prose before or after.`

/** If the model wrapped its output in a ```...``` fence (often with prose around it),
 * extract the first fenced block; otherwise return the text as-is. */
export function stripCodeFences(s: string): string {
  const t = s.trim()
  const block = t.match(/```[a-zA-Z0-9+#-]*\s*\r?\n([\s\S]*?)\r?\n```/)
  if (block) return block[1].trim()
  return t
}

/** Layer an expert's persona (optional) over the format-enforcing instructions: the
 * expert shapes the content, the format rules govern the output. */
function composeSystem(persona: string | undefined, formatInstructions: string): string {
  const p = persona?.trim()
  if (!p) return formatInstructions
  return `${p}\n\n---\nYou are now producing a document. Apply your expertise and judgment to the CONTENT, but you MUST follow these output rules exactly:\n\n${formatInstructions}`
}

/** Generate a self-contained Typst document from a request (+ optional reference context). */
export async function generateTypstDoc(opts: {
  request: string
  context?: string
  persona?: string
  settings: Settings
  signal?: AbortSignal
  onContent?: (delta: string) => void
}): Promise<string> {
  const user = [
    `Create the following document:\n\n${opts.request.trim()}`,
    opts.context?.trim()
      ? `\n\nReference material to draw from (do not copy verbatim unless quoting is appropriate):\n\n${opts.context.trim()}`
      : '',
    '\n\nOutput only the Typst source.',
  ].join('')
  const { content } = await streamChat({
    baseUrl: opts.settings.baseUrl,
    model: opts.settings.model,
    messages: [
      { role: 'system', content: composeSystem(opts.persona, TYPST_SYSTEM) },
      { role: 'user', content: user },
    ],
    temperature: opts.settings.temperature,
    topP: opts.settings.topP,
    maxTokens: 0,
    signal: opts.signal,
    handlers: { onContent: opts.onContent },
  })
  return stripCodeFences(content)
}

/** Repair a Typst document that failed to compile, given the compiler error. */
export async function fixTypstDoc(opts: {
  source: string
  error: string
  settings: Settings
  signal?: AbortSignal
  onContent?: (delta: string) => void
}): Promise<string> {
  const user = `This Typst document failed to compile. Fix it so it compiles cleanly, changing as little as possible and preserving the content. Output ONLY the corrected Typst source.

--- Typst source ---
${opts.source}

--- Compiler error ---
${opts.error}`
  const { content } = await streamChat({
    baseUrl: opts.settings.baseUrl,
    model: opts.settings.model,
    messages: [
      { role: 'system', content: TYPST_SYSTEM },
      { role: 'user', content: user },
    ],
    temperature: opts.settings.temperature,
    topP: opts.settings.topP,
    maxTokens: 0,
    signal: opts.signal,
    handlers: { onContent: opts.onContent },
  })
  return stripCodeFences(content)
}

/** Generate the complete contents of a plain-text / code file (HTML, Java, Markdown, …). */
export async function generateTextDoc(opts: {
  request: string
  fileType: string
  context?: string
  persona?: string
  settings: Settings
  signal?: AbortSignal
  onContent?: (delta: string) => void
}): Promise<string> {
  const system = composeSystem(
    opts.persona,
    `You generate the complete contents of a single ${opts.fileType} file. Output ONLY the raw file contents — no explanations, no commentary, and no markdown code fences. The result must be complete, correct, and ready to save directly to a file that an IDE or editor can open and use.`,
  )
  const user = [
    `Create a ${opts.fileType} file for the following:\n\n${opts.request.trim()}`,
    opts.context?.trim() ? `\n\nReference material to draw from:\n\n${opts.context.trim()}` : '',
    `\n\nOutput only the ${opts.fileType} file contents.`,
  ].join('')
  const { content } = await streamChat({
    baseUrl: opts.settings.baseUrl,
    model: opts.settings.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: opts.settings.temperature,
    topP: opts.settings.topP,
    maxTokens: 0,
    signal: opts.signal,
    handlers: { onContent: opts.onContent },
  })
  return stripCodeFences(content)
}

/** Edit an existing document/file: apply an instruction to its current contents and
 * return the full updated file (Typst, HTML, code, …). */
export async function editDoc(opts: {
  current: string
  instruction: string
  fileType: string
  persona?: string
  settings: Settings
  signal?: AbortSignal
  onContent?: (delta: string) => void
}): Promise<string> {
  const base = `You are editing an existing ${opts.fileType} file. Apply the user's requested change and output the COMPLETE updated file contents — raw, with no explanations, no commentary, and no markdown code fences. Preserve everything the change doesn't touch. The result must be a valid, complete ${opts.fileType} file.`
  const system = composeSystem(opts.persona, base)
  const user = `Here is the current ${opts.fileType} file:\n\n${opts.current}\n\nRequested change:\n${opts.instruction}\n\nOutput the full updated file.`
  const { content } = await streamChat({
    baseUrl: opts.settings.baseUrl,
    model: opts.settings.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: opts.settings.temperature,
    topP: opts.settings.topP,
    maxTokens: 0,
    signal: opts.signal,
    handlers: { onContent: opts.onContent },
  })
  return stripCodeFences(content)
}

// ----------------------------- Character generation -----------------------------

export async function generateCharacter(
  criteria: string,
  settings: Settings,
  signal?: AbortSignal,
): Promise<Partial<Character>> {
  const system = `You design a roleplay character card and return STRICT JSON only — no markdown, no commentary.
Given the user's criteria, invent a complete, coherent, vivid character.
Return a JSON object with exactly these string keys:
- "name": the character's name
- "avatar": a single emoji that fits them
- "description": appearance and background (2-4 sentences)
- "personality": temperament and manner (2-3 sentences)
- "scenario": the character's general backdrop/role — who and where they typically are (1-2 sentences)
- "exampleDialogue": 2-4 example lines alternating "{{user}}:" and "{{char}}:"
Output ONLY the JSON object.`

  const content = await complete(
    settings,
    [
      { role: 'system', content: system },
      { role: 'user', content: `Criteria: ${criteria}` },
    ],
    signal,
  )
  const j = extractJSON(content) as Record<string, unknown> | null
  if (!j || typeof j !== 'object') {
    throw new Error('Model did not return a parseable character. Try again or rephrase the criteria.')
  }
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  return {
    name: str(j.name).slice(0, 60),
    avatar: (str(j.avatar) || '🙂').slice(0, 2),
    color: randomColor(),
    description: str(j.description),
    personality: str(j.personality),
    scenario: str(j.scenario),
    exampleDialogue: str(j.exampleDialogue),
    systemPrompt: '',
  }
}

/** Create a full character card from a name referenced in a scene. */
export async function generateCharacterFromReference(opts: {
  name: string
  context: string
  settings: Settings
  signal?: AbortSignal
}): Promise<Partial<Character>> {
  const system = `You design a roleplay character card and return STRICT JSON only — no markdown, no commentary.
A character named "${opts.name}" is referenced in a scene. Invent a complete, coherent character consistent with how they are referenced.
Return a JSON object with exactly these string keys:
- "name": use "${opts.name}"
- "avatar": a single emoji that fits them
- "description": appearance and background (2-4 sentences)
- "personality": temperament and manner (2-3 sentences)
- "scenario": their general backdrop/role (1-2 sentences)
- "exampleDialogue": 2-4 lines alternating "{{user}}:" and "{{char}}:"
Output ONLY the JSON object.`
  const user = `How they are referenced: "${opts.context.trim().slice(0, 600)}"\n\nCreate the character "${opts.name}".`
  const content = await complete(opts.settings, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], opts.signal)
  const j = extractJSON(content) as Record<string, unknown> | null
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  return {
    name: (str(j?.name) || opts.name).slice(0, 60),
    avatar: (str(j?.avatar) || '🙂').slice(0, 2),
    color: randomColor(),
    description: str(j?.description),
    personality: str(j?.personality),
    scenario: str(j?.scenario),
    exampleDialogue: str(j?.exampleDialogue),
    systemPrompt: '',
  }
}

const cleanText = (s: string): string => s.trim().replace(/^["']+|["']+$/g, '').trim()

/** Expand/deepen a single character-card field, using the rest of the card as context. */
export async function expandCharacterField(opts: {
  field: string
  current: string
  character: Partial<Character>
  settings: Settings
  signal?: AbortSignal
}): Promise<string> {
  const c = opts.character
  const ctx = [
    c.name ? `Name: ${c.name}` : '',
    c.description ? `Description: ${c.description}` : '',
    c.personality ? `Personality: ${c.personality}` : '',
    c.scenario ? `Backdrop: ${c.scenario}` : '',
  ]
    .filter(Boolean)
    .join('\n')
  const system = `You enrich one field of a roleplay character card. Return ONLY the rewritten field text — no labels, no surrounding quotes, no commentary.
Rewrite and EXPAND the "${opts.field}" field into a richer, more vivid, more in-depth version — roughly twice the detail, the same voice and intent, fully consistent with the rest of the character. If it is empty, write one from scratch that fits.`
  const user = `Character so far:\n${ctx || '(little defined yet)'}\n\nCurrent "${opts.field}":\n${opts.current.trim() || '(empty)'}`
  const text = await complete(opts.settings, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], opts.signal)
  return cleanText(text)
}

/** Generate an opening-scene prompt for a new chat. */
export async function generateScenePrompt(opts: {
  character: Character
  persona: Persona
  settings: Settings
  signal?: AbortSignal
}): Promise<string> {
  const { character, persona } = opts
  const who = [character.description, character.personality, character.scenario].filter(Boolean).join(' ')
  const system = `You write the OPENING SCENE setup for a roleplay between ${persona.name || 'the user'} and ${character.name}. Establish where and when they are and the immediate situation that kicks off the scene — a hook. Return ONLY the scene text (2-4 sentences), present tense; set the stage, do not write dialogue or resolve anything. No commentary.`
  const user = `${character.name}: ${who}\nUser (${persona.name}): ${persona.description || 'a traveler'}\n\nWrite an engaging opening scene.`
  const text = await complete(opts.settings, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], opts.signal)
  return cleanText(text)
}

/** Enrich a user-written opening-scene prompt. */
export async function expandScenePrompt(opts: {
  current: string
  character: Character
  persona: Persona
  settings: Settings
  signal?: AbortSignal
}): Promise<string> {
  const { current, character, persona } = opts
  const who = [character.description, character.personality, character.scenario].filter(Boolean).join(' ')
  const system = `You enrich an opening-scene setup for a roleplay between ${persona.name || 'the user'} and ${character.name}. Return ONLY the rewritten scene (2-5 sentences) — richer sensory detail and a clearer hook, present tense; do not write dialogue or resolve the scene. No commentary.`
  const user = `${character.name}: ${who}\nUser (${persona.name}): ${persona.description || ''}\n\nCurrent scene:\n${current.trim() || '(empty — invent a fitting one)'}`
  const text = await complete(opts.settings, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], opts.signal)
  return cleanText(text)
}

// ------------------------------- Story beats -------------------------------

function castBlock(cast: Character[]): string {
  return cast.map((c) => `- ${c.name}: ${(c.personality || c.description || '').trim()}`).join('\n')
}

export interface ParsedBeat {
  speaker: string
  type: BeatType
  text: string
}

const POV_TEXT: Record<POV, string> = {
  '1st': 'first person ("I")',
  '2nd': 'second person ("you")',
  '3rd': 'third person',
}

function pacingText(p: number): string {
  if (p >= 80) return 'fast and propulsive'
  if (p >= 60) return 'brisk'
  if (p >= 40) return 'steady'
  if (p >= 20) return 'slow-burn'
  return 'very slow and simmering'
}

const INTENSITY_TEXT = [
  '',
  'wholesome — keep it tame, no on-page sex or graphic violence',
  'mild',
  'suggestive — imply heat and danger without explicit detail',
  'mature and steamy — sensual and intense, written with craft',
  'fully explicit and uncensored — do not fade to black',
]

function flowText(curve: number[]): string {
  const label = (v: number) =>
    v >= 75 ? 'mostly description' : v >= 58 ? 'lean descriptive' : v >= 42 ? 'balanced' : v >= 25 ? 'lean dialogue' : 'mostly dialogue'
  return curve.map((v, i) => `(${i + 1}) ${label(v)}`).join(', ')
}

function storySystem(opts: {
  cast: Character[]
  premise: string
  targetWords: number
  chunkWords: number
  conclude: boolean
  isContinue: boolean
  dials: StoryDials
  steerLines: string[]
  flowCurve: number[]
  sources: Source[]
}): string {
  const { cast, premise, targetWords, chunkWords, conclude, isContinue, dials, steerLines, flowCurve } = opts
  const example = cast[0]?.name ?? 'Name'
  const steer = steerLines.map((s) => s.trim()).filter(Boolean)

  const dir: string[] = []
  dir.push(dials.setting.trim() ? `Setting: ${dials.setting.trim()}` : 'Setting: invent a specific, fitting time and place.')
  if (dials.genre.trim()) dir.push(`Genre: ${dials.genre.trim()}`)
  if (dials.tone.length) dir.push(`Tone: ${dials.tone.join(', ')}`)
  dir.push(`Narration: ${POV_TEXT[dials.pov]}`)
  dir.push(`Pace: ${pacingText(dials.pacing)}`)
  dir.push(`Content intensity: ${INTENSITY_TEXT[dials.intensity] ?? 'mild'}`)
  if (dials.ending.trim()) dir.push(`Aim the ending toward: ${dials.ending.trim()}`)

  const blocks: string[] = [
    'You are a master novelist writing a long, immersive, slowly-unfolding scene in screenplay-style prose.',
    `Cast:\n${castBlock(cast)}`,
    `Direction:\n- ${dir.join('\n- ')}`,
    `Seed idea: ${premise.trim() || '(none — invent something fitting the direction)'}\nTreat the seed as a spark: establish a vivid, specific when/where and sensory flavor, then UNFOLD it into a fully-developed scene — never merely restate the seed or race through it.`,
  ]
  if (steer.length) {
    blocks.push(
      `Touchstone beats — steer the scene toward moments with the flavor of these lines (match their tone and intensity; build toward such beats naturally, do NOT quote them verbatim):\n${steer.map((s) => `- ${s}`).join('\n')}`,
    )
  }
  const src = sourcesBlock(opts.sources)
  if (src) blocks.push(src)
  blocks.push(`Rhythm — vary the prose-vs-dialogue balance across 10 equal segments of the scene: ${flowText(flowCurve)}.`)

  blocks.push(`LENGTH & PACING — this is the most important instruction:
- This is a LONG scene of roughly ${targetWords} words total. ${isContinue ? `Continue from where the text leaves off and write about ${chunkWords} more words now.` : `Write about ${chunkWords} words in this opening stretch.`}
- Develop SLOWLY and patiently. Linger: render the setting, body language, sensory and emotional detail, interiority, subtext, hesitations, small actions and silences. Let conversations meander and breathe.
- Do NOT summarize, compress, time-skip, or rush. Expand every beat into fully-written prose — a single exchange can fill several paragraphs.
- ${conclude ? 'You are in the FINAL stretch — begin guiding the scene toward a satisfying close.' : 'Do NOT conclude, resolve, or wrap up yet — there is much more scene still to come. End this portion mid-momentum, leaving the scene wide open to continue.'}`)

  blocks.push(`Format rules — follow exactly:
- Each character's dialogue/action is its own paragraph beginning with their name and a colon, e.g.
  ${example}: "Spoken words." *A described action, rendered with detail.*
- Narration/description go in their own paragraphs with NO name prefix.
- Use "quotes" for speech and *asterisks* for actions/description.
- Separate every paragraph with a blank line.
- Keep every character consistent.
${isContinue ? '' : '- Plan briefly; spend your effort on the prose, not the planning.\n'}Write ONLY the scene — no title, no headings, no commentary.`)
  return blocks.join('\n\n')
}

/** Generate one portion of a scene in a streamed pass. Returns the portion's text. */
export async function generateStory(opts: {
  cast: Character[]
  premise: string
  targetWords: number
  chunkWords: number
  conclude: boolean
  dials: StoryDials
  steerLines: string[]
  flowCurve: number[]
  sources?: Source[]
  previous?: string
  settings: Settings
  signal?: AbortSignal
  onReasoning?: (delta: string) => void
  onContent?: (delta: string) => void
}): Promise<string> {
  const messages: ApiMessage[] = [
    {
      role: 'system',
      content: storySystem({
        cast: opts.cast,
        premise: opts.premise,
        targetWords: opts.targetWords,
        chunkWords: opts.chunkWords,
        conclude: opts.conclude,
        isContinue: !!opts.previous,
        dials: opts.dials,
        steerLines: opts.steerLines,
        flowCurve: opts.flowCurve,
        sources: opts.sources ?? [],
      }),
    },
    {
      role: 'user',
      content: opts.previous
        ? `The scene so far:\n\n${opts.previous}\n\nContinue it now in the same format and direction, writing about ${opts.chunkWords} more words. Do not repeat what is already written.`
        : 'Write the scene now.',
    },
  ]
  const { content } = await streamChat({
    baseUrl: opts.settings.baseUrl,
    model: opts.settings.model,
    messages,
    temperature: opts.settings.temperature,
    topP: opts.settings.topP,
    maxTokens: 0,
    signal: opts.signal,
    handlers: { onReasoning: opts.onReasoning, onContent: opts.onContent },
  })
  return content
}

const isActionOnly = (s: string): boolean => /^\*.*\*$/.test(s) && !s.includes('"')

/** Parse screenplay prose ("Name: ..." paragraphs + narration) into structured beats. */
export function parseScreenplay(text: string, castNames: string[]): ParsedBeat[] {
  const beats: ParsedBeat[] = []
  let cur: ParsedBeat | null = null
  const flush = () => {
    if (cur && cur.text.trim()) beats.push(cur)
    cur = null
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) {
      flush()
      continue
    }
    let speaker: string | null = null
    let prefixLen = 0
    for (const name of castNames) {
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const m = line.match(new RegExp('^(?:the\\s+)?' + esc + '\\s*:', 'i'))
      if (m) {
        speaker = name
        prefixLen = m[0].length
        break
      }
    }
    const narr = line.match(/^(?:narrator|narration)\s*:\s*(.*)$/i)
    if (speaker) {
      flush()
      const body = line.slice(prefixLen).trim()
      cur = { speaker, type: isActionOnly(body) ? 'action' : 'dialogue', text: body }
    } else if (narr) {
      flush()
      cur = { speaker: 'Narrator', type: 'narration', text: narr[1] }
    } else if (cur) {
      cur.text += ' ' + line // continuation / wrapped line
    } else {
      cur = { speaker: 'Narrator', type: 'narration', text: line }
    }
  }
  flush()
  return beats
}

// ---------------------------- Dialogue tree node ----------------------------

export interface PathStep {
  line: string
  choice: string
}

export async function generateDialogueNode(
  npc: Character | null,
  npcName: string,
  premise: string,
  path: PathStep[],
  opts: { isLeaf: boolean; maxBreadth: number },
  settings: Settings,
  signal?: AbortSignal,
): Promise<{ line: string; options: string[] }> {
  const desc = npc ? (npc.personality || npc.description || '').trim() : ''
  const pathBlock = path.length
    ? path.map((p) => `${npcName}: ${p.line}\nPlayer: ${p.choice}`).join('\n')
    : '(start of conversation)'

  const system = `You are writing a branching game dialogue between an NPC and the player.
NPC: ${npcName}${desc ? ` — ${desc}` : ''}
Situation: ${premise}

Write the NPC's next line, then ${
    opts.isLeaf
      ? 'because this is an ENDING node, return an empty options array'
      : `2-${opts.maxBreadth} distinct player response options that branch the conversation in meaningfully different directions`
  }.
Return STRICT JSON only: {"line": the NPC's spoken line, "options": [${opts.isLeaf ? '' : 'player choice text, …'}]}
Output ONLY the JSON object.`

  const user = `Conversation path so far:\n${pathBlock}\n\nWrite the NPC's response${
    opts.isLeaf ? ' (final line, empty options).' : ' and the player options.'
  }`
  const content = await complete(settings, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ], signal)

  const j = extractJSON(content) as Record<string, unknown> | null
  if (!j || typeof j.line !== 'string') {
    return { line: content.trim().slice(0, 400) || '…', options: [] }
  }
  const rawOpts = Array.isArray(j.options) ? j.options : []
  const options = rawOpts
    .map((o) => (typeof o === 'string' ? o : ((o as { text?: string })?.text ?? '')))
    .map((s) => String(s).trim())
    .filter(Boolean)
    .slice(0, opts.maxBreadth)
  return { line: j.line, options }
}
