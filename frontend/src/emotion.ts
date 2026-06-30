// "Living" portraits: the emotion set, a render-time heuristic that reads a message's emotional
// tone (pure + instant — no model call), and an art-prompt generator that produces a consistent
// set of image prompts for a character's emotion portraits.
import type { EmotionKey } from './types'

export interface EmotionDef {
  key: EmotionKey
  label: string
  expression: string // used in the art prompt
  cues: string[] // lowercase substrings (word stems) that signal this emotion
}

export const EMOTIONS: EmotionDef[] = [
  { key: 'neutral', label: 'Neutral', expression: 'a calm, composed, neutral expression', cues: [] },
  {
    key: 'happy',
    label: 'Happy',
    expression: 'a warm, genuine smile with bright, cheerful eyes',
    cues: ['smil', 'grin', 'laugh', 'chuckl', 'beam', 'delight', 'joy', 'glad', 'cheer', 'happy', 'haha', 'giggl', '😊', '😄', '😁', '😃'],
  },
  {
    key: 'sad',
    label: 'Sad',
    expression: 'a sorrowful, downcast expression, eyes lowered, on the verge of tears',
    cues: ['sigh', 'tear', 'cry', 'cried', 'weep', 'wept', 'sob', 'frown', 'sorrow', 'mourn', 'grief', 'downcast', 'heartbroken', 'despair', '😢', '😭', '😔'],
  },
  {
    key: 'angry',
    label: 'Angry',
    expression: 'a fierce, angry glare, brows furrowed, jaw clenched',
    cues: ['glar', 'scowl', 'snarl', 'growl', 'fury', 'furious', 'rage', 'anger', 'angry', 'clench', 'grit', 'snap', 'seethe', 'shout', 'yell', '😠', '😡', '🤬'],
  },
  {
    key: 'surprised',
    label: 'Surprised',
    expression: 'wide eyes and raised eyebrows, mouth open in genuine surprise',
    cues: ['gasp', 'blink', 'widen', 'wide-eyed', 'startl', 'jolt', 'taken aback', 'shock', 'stunned', 'astonish', 'whoa', '?!', '😲', '😮', '😯'],
  },
  {
    key: 'fearful',
    label: 'Afraid',
    expression: 'a frightened, fearful expression, eyes wide, recoiling slightly',
    cues: ['trembl', 'shiver', 'shudder', 'flinch', 'recoil', 'dread', 'terror', 'terrified', 'afraid', 'scared', 'fear', 'panic', ' pale', 'nervous', 'cower', '😨', '😱', '😰'],
  },
  {
    key: 'embarrassed',
    label: 'Embarrassed',
    expression: 'flushed red cheeks, a shy, flustered, embarrassed look, eyes glancing away',
    cues: ['blush', 'flush', 'redden', 'fluster', 'stammer', 'stutter', 'sheepish', 'avert', 'embarrass', '😳', '😅', '🥵'],
  },
  {
    key: 'affectionate',
    label: 'Affectionate',
    expression: 'a soft, tender, loving gaze with a gentle, affectionate smile',
    cues: ['caress', 'embrace', 'tender', 'gaze', 'lean in', 'nuzzle', 'warmth', 'adore', 'soft smile', 'gentle', 'cherish', 'kiss', '💕', '❤', '🥰', '😍'],
  },
]

export const EMOTION_KEYS = EMOTIONS.map((e) => e.key)
const NON_NEUTRAL = EMOTIONS.filter((e) => e.key !== 'neutral')

/** Heuristic emotional-tone read of a message — pure + instant, no model call. Scores each
 *  emotion by cue hits, weighting *action beats* (what the character does) over plain dialogue. */
export function detectEmotion(text: string): EmotionKey {
  if (!text) return 'neutral'
  const lower = text.toLowerCase()
  const actions = (text.match(/\*[^*]+\*/g) || []).join(' ').toLowerCase() // the *...* stage directions
  let best: EmotionKey = 'neutral'
  let bestScore = 0
  for (const e of NON_NEUTRAL) {
    let score = 0
    for (const cue of e.cues) {
      if (lower.includes(cue)) score += 1
      if (actions.includes(cue)) score += 2 // actions are the strongest signal
    }
    if (score > bestScore) {
      bestScore = score
      best = e.key
    }
  }
  return best
}

const ART_STYLE =
  'Bust / upper-body framing, facing forward, clean simple or transparent background, ' +
  'soft cinematic lighting, high detail, consistent art style. Square 1024×1024.'

/** A copy-pasteable set of image prompts — one per emotion — that share one appearance + style so
 *  the generated set stays the SAME character. */
export function buildEmotionArtPrompts(c: { name?: string; description?: string }): string {
  const name = (c.name || '').trim() || 'this character'
  const appearance = (c.description || '').trim() || `${name}, a distinctive character`
  const slug = (c.name || 'character').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'character'
  const header =
    `Create a CONSISTENT SET of emotion portraits of the same character, "${name}".\n\n` +
    `CHARACTER — keep this IDENTICAL in every image (same face, hair, clothing, age, and art ` +
    `style; only the facial expression and body language change):\n${appearance}\n\n` +
    `STYLE for all images: ${ART_STYLE}\n\n` +
    `Generate "Neutral" FIRST, then use that image as the reference so every other one matches it ` +
    `exactly. Make each a SEPARATE image. Name the files "${slug}-<emotion>.png".\n\n` +
    `THE ${EMOTIONS.length} EMOTIONS:`
  const lines = EMOTIONS.map((e, i) => `${i + 1}. ${e.label} (${e.key}) — ${e.expression}.`)
  return [header, ...lines].join('\n')
}
