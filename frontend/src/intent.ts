// Intent router ("control net"): classify an Ask-mode prompt against the app's capabilities
// so the UI can suggest the matching tool (one click to run) or ask for clarification.
//
// This module is PURE logic — no network, no React. The single LLM call lives in
// api/ollama (runIntentClassifier). Here we: gate cheap cases (looksActionable), build the
// classifier prompt, and robustly parse + validate the model's JSON with a hard fallback.
// Keeping it pure is what makes a control net testable, and therefore trustworthy.
import { extractJSON } from './json'

export type IntentId =
  | 'find_images_pdf'
  | 'generate_document'
  | 'edit_file'
  | 'analyze_image'
  | 'answer_from_folder'
  | 'chat'

export interface IntentSpec {
  id: IntentId
  label: string // short human label for the suggestion chip
  emoji: string
  description: string // what it does — shown to the classifier
  examples: string[] // trigger phrasings (documentation + few-shot fodder)
  params: string[] // param keys the model should try to extract
}

/** The app's routable capabilities. `chat` is the catch-all / "none of the tools". */
export const INTENTS: IntentSpec[] = [
  {
    id: 'find_images_pdf',
    label: 'Find images → PDF',
    emoji: '🔎',
    description: 'Scan a folder of images, keep the ones matching a description, and build a PDF of the matches.',
    examples: [
      'search my attached folder for cats and put them in a pdf',
      'go through the photos folder and find every picture with a dog, make a pdf',
      'collect the screenshots that contain code into a document',
    ],
    params: ['criterion', 'folder'],
  },
  {
    id: 'generate_document',
    label: 'Generate a document',
    emoji: '📄',
    description:
      'Write a NEW document from a description — a PDF (prose, math, tables) or a text/code file (HTML, Python, Markdown, etc.).',
    examples: [
      'write me a one-page PDF about the water cycle',
      'generate an HTML landing page for a coffee shop',
      'make a python script that renames files by date',
    ],
    params: ['topic', 'format'],
  },
  {
    id: 'edit_file',
    label: 'Edit a file',
    emoji: '✏️',
    description: 'Open an EXISTING file the user points to and modify it.',
    examples: [
      'open index.html and make the header bigger',
      'edit my resume.md to add a skills section',
      'take this file and translate the comments to spanish',
    ],
    params: ['path', 'change'],
  },
  {
    id: 'analyze_image',
    label: 'Analyze an image',
    emoji: '👁',
    description: 'Look at, describe, or answer questions about one or more images.',
    examples: ['what is in this picture', 'describe the attached screenshot', 'read the text in this image'],
    params: ['question'],
  },
  {
    id: 'answer_from_folder',
    label: 'Answer from your folder',
    emoji: '📁',
    description: "Answer a question using the documents in the user's attached knowledge folder.",
    examples: [
      'according to my notes, what did we decide about pricing',
      'summarize the attached folder',
      'what do my documents say about the refund policy',
    ],
    params: ['question'],
  },
  {
    id: 'chat',
    label: 'Just chat',
    emoji: '💬',
    description: 'An ordinary question or conversation that needs none of the tools above.',
    examples: ['explain how photosynthesis works', 'write a haiku about winter', 'what is the capital of France'],
    params: [],
  },
]

/** Confidence at/above which a non-chat intent is worth surfacing as a suggestion. */
export const MIN_CONFIDENCE = 0.6

export interface Classification {
  intent: IntentId
  confidence: number // 0..1
  params: Record<string, string>
  clarify: string // a short question if a required param is missing, else ''
}

// Quick-mode gate: cheap keywords that hint the user wants an action, so we don't spend an
// LLM round-trip on every ordinary chat. Full mode skips this and always classifies.
const ACTION_WORDS = [
  'folder', 'directory', 'pdf', 'document', 'file', 'files', 'image', 'images', 'photo', 'photos',
  'picture', 'pictures', 'screenshot', 'screenshots', 'generate', 'create', 'build', 'make', 'write',
  'draft', 'search', 'find', 'scan', 'collect', 'gather', 'edit', 'open', 'modify', 'rewrite',
  'describe', 'analyze', 'analyse', 'summarize', 'summarise',
]
const ACTION_RE = new RegExp(`\\b(${ACTION_WORDS.join('|')})\\b`, 'i')
const FILE_EXT_RE = /\.(html?|pdf|md|markdown|py|js|ts|jsx|tsx|css|json|csv|txt|docx?|java|go|rs|c|cpp|sh|sql)\b/i

/** True if the text plausibly asks for one of the tools (the cheap pre-filter for Quick mode). */
export function looksActionable(text: string): boolean {
  if (!text) return false
  return FILE_EXT_RE.test(text) || ACTION_RE.test(text)
}

/** Build the classifier prompt: the capability menu + a strict JSON contract. */
export function buildClassifierPrompt(userText: string, intents: IntentSpec[] = INTENTS): string {
  const menu = intents
    .map((i) => `- ${i.id}: ${i.description}${i.params.length ? ` [params: ${i.params.join(', ')}]` : ''}`)
    .join('\n')
  return [
    'You are an intent classifier for a local AI desktop app. Decide which ONE capability the user is asking for.',
    '',
    'Capabilities:',
    menu,
    '',
    'Reply with ONLY a JSON object (no prose, no code fence) in exactly this shape:',
    '{"intent":"<id>","confidence":<number 0..1>,"params":{...extracted params...},"clarify":"<short question if a required param is missing, else empty string>"}',
    '',
    'Rules:',
    '- Use "chat" for an ordinary question/conversation that needs none of the tools.',
    '- confidence = how sure you are this is the right capability AND that the user truly wants that action.',
    '- Only include params you can directly extract from the message. Never invent a folder or file path.',
    '- If a required param is missing (e.g. a folder search with no folder named), put a brief question in "clarify".',
    '',
    `User message: """${userText.replace(/"""/g, '"')}"""`,
    'JSON:',
  ].join('\n')
}

/**
 * Parse + validate the model's classification JSON. Returns null on anything malformed
 * (caller falls back to plain chat) — a control net must never act on garbage.
 */
export function parseClassification(raw: string, intents: IntentSpec[] = INTENTS): Classification | null {
  const obj = extractJSON(raw)
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  const rec = obj as Record<string, unknown>

  const id = rec.intent
  if (typeof id !== 'string' || !intents.some((i) => i.id === id)) return null

  let confidence = Number(rec.confidence)
  if (!Number.isFinite(confidence)) confidence = 0
  confidence = Math.max(0, Math.min(1, confidence))

  const params: Record<string, string> = {}
  if (rec.params && typeof rec.params === 'object' && !Array.isArray(rec.params)) {
    for (const [k, v] of Object.entries(rec.params as Record<string, unknown>)) {
      if (v != null && v !== '') params[k] = String(v).trim()
    }
  }

  const clarify = typeof rec.clarify === 'string' ? rec.clarify.trim() : ''
  return { intent: id as IntentId, confidence, params, clarify }
}

/** Whether a classification is worth surfacing as a one-click suggestion. */
export function isActionable(c: Classification | null): c is Classification {
  return !!c && c.intent !== 'chat' && c.confidence >= MIN_CONFIDENCE
}

/** The most descriptive extracted detail for the chip label, if any. */
export function primaryParam(c: Classification): string {
  return c.params.criterion || c.params.topic || c.params.change || c.params.question || c.params.path || ''
}

/** Human label for the suggestion chip, e.g. "🔎 Find images → PDF: cats". */
export function describeIntent(c: Classification): string {
  const spec = INTENTS.find((i) => i.id === c.intent)
  if (!spec) return ''
  const detail = primaryParam(c)
  return `${spec.emoji} ${spec.label}${detail ? `: ${detail}` : ''}`
}

// Map a free-text format word ("python", "PDF", "an html page") to a DocumentModal format id.
const DOC_FORMAT_ALIASES: Record<string, string> = {
  pdf: 'pdf', typst: 'pdf', md: 'md', markdown: 'md', html: 'html', htm: 'html', webpage: 'html',
  txt: 'txt', text: 'txt', java: 'java', py: 'py', python: 'py', js: 'js', javascript: 'js',
  ts: 'ts', typescript: 'ts', css: 'css', json: 'json', csv: 'csv', sql: 'sql', yaml: 'yaml', yml: 'yaml', xml: 'xml',
}

/** Resolve the document format the user named, or undefined if unrecognized (caller defaults to PDF). */
export function normalizeDocFormat(f?: string): string | undefined {
  if (!f) return undefined
  const lc = f.toLowerCase()
  for (const [word, id] of Object.entries(DOC_FORMAT_ALIASES)) {
    if (new RegExp(`\\b${word}\\b`).test(lc)) return id
  }
  return undefined
}

// ── Deterministic heuristics ──────────────────────────────────────────────────
// The LLM classifier is fuzzy, and local models are unreliable at strict JSON, so the
// router tries these high-signal patterns FIRST. They map straight to an action with no
// model call — so the obvious cases always surface the Run chip instead of silently
// falling back to chat. Confirm-first means over-offering is cheap (a dismissible chip).

function cleanParams(params: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(params)) {
    const s = (v ?? '').trim()
    if (s) out[k] = s
  }
  return out
}

const LEADING_FILLER = /^(?:just|only|all|any|some|the|a|an|my|every|these|those)\s+/gi

/** Best-effort pull of the "what to look for" descriptor from a folder-image request. */
export function extractCriterion(text: string): string {
  const t = text.trim()
  const strip = (s: string) => s.replace(LEADING_FILLER, '').replace(LEADING_FILLER, '').trim()
  // 1) "... for/of/with/containing X [in/from a folder]"
  let m = t.match(
    /\b(?:for|of|with|containing|showing|matching|that\s+(?:are|have|show)|where\s+there(?:'s| is| are))\s+(.+?)(?:\s+(?:in|from|inside|within|on)\b.*)?$/i,
  )
  let crit = strip(m?.[1] ?? '')
  crit = crit.replace(/\s+and\b.*$/i, '').trim() // drop "... and put them in a pdf"
  crit = crit.replace(/\s*\b(pictures?|photos?|images?|pics?|shots?)\b\s*$/gi, '').trim()
  // 2) Fallback: "<X> pictures/images/photos"
  if (!crit) {
    m = t.match(/\b((?:[\w-]+\s+){0,1}[\w-]+)\s+(?:pictures?|photos?|images?|pics?)\b/i)
    crit = strip(m?.[1] ?? '')
  }
  return crit.replace(/[.?!,;:]+$/, '').trim()
}

/**
 * High-precision, deterministic intent detection for the obvious cases — no LLM needed, so it
 * fires reliably. Returns null when nothing clearly matches (caller falls back to the classifier).
 */
export function heuristicIntent(text: string): Classification | null {
  const t = text.toLowerCase()
  const folder = /\b(folder|directory)\b/.test(t)
  const imageNoun = /\b(images?|photos?|pictures?|pics?|screenshots?)\b/.test(t)
  const findVerb = /\b(find|search|check|scan|look|locate|collect|gather|pull|grab|sort|filter)\b/.test(t)
  const pdf = /\bpdf\b/.test(t)

  // 1) Folder image-search → PDF (the headline workflow).
  if ((folder && (imageNoun || pdf || findVerb)) || (imageNoun && (findVerb || pdf))) {
    return { intent: 'find_images_pdf', confidence: 0.95, params: cleanParams({ criterion: extractCriterion(text) }), clarify: '' }
  }

  // 2) Edit an existing file the user names (filename with an extension) — checked BEFORE
  //    generation so "open index.html and …" isn't mistaken for "make an HTML file".
  const fileMatch = t.match(/\b([\w.-]+\.(?:html?|md|markdown|txt|css|jsx?|tsx?|json|py|rs|go|java|c|cpp|sh|sql|csv|xml|ya?ml|typ))\b/)
  const editVerb = /\b(edit|open|modify|change|update|fix|rewrite|refactor|tweak|adjust|improve)\b/.test(t)
  if (fileMatch && editVerb) {
    return { intent: 'edit_file', confidence: 0.9, params: cleanParams({ path: fileMatch[1], change: text.trim() }), clarify: '' }
  }

  // 3) Generate a new document from a description (not a folder op, not editing a named file).
  const makeVerb = /\b(write|create|generate|make|build|draft|compose|produce)\b/.test(t)
  const docNoun =
    /\b(document|pdf|report|essay|letter|memo|article|resume|résumé|cv|html|web\s?page|website|markdown|readme|script|program|spreadsheet|css|json|cover\s+letter)\b/.test(t)
  if (makeVerb && docNoun && !folder) {
    return { intent: 'generate_document', confidence: 0.9, params: cleanParams({ topic: text.trim(), format: normalizeDocFormat(t) }), clarify: '' }
  }

  return null
}
