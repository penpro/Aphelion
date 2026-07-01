export type Role = 'user' | 'assistant' | 'system'

export type EmotionKey =
  | 'neutral'
  | 'happy'
  | 'sad'
  | 'angry'
  | 'surprised'
  | 'fearful'
  | 'embarrassed'
  | 'affectionate'

/** A named portrait set (e.g. an outfit/look like "Hair up" or "Nude"), holding up to the 8 emotion portraits. */
export interface PortraitSet {
  id: string
  name: string
  description?: string // what this look shows (outfit/appearance) — typed or filled by the vision scan; drives auto-switch
  portraits: Partial<Record<EmotionKey, string>>
}

export interface Character {
  id: string
  name: string
  avatar: string // emoji or single glyph
  color: string // accent color (hex)
  description: string // appearance / background
  personality: string
  scenario: string // the character's general backdrop/role
  exampleDialogue: string
  systemPrompt: string // extra steering, appended to the base RP instruction
  portrait?: string // optional image data URL; falls back to the avatar emoji + color tile
  portraits?: Partial<Record<EmotionKey, string>> // legacy single living set (migrated into portraitSets on edit)
  portraitSets?: PortraitSet[] // named portrait sets (outfits/looks), each with up to the 8 emotion portraits
  createdAt: number
}

export interface Persona {
  name: string
  description: string
}

export interface Swipe {
  content: string
  reasoning: string
}

export interface ChatMessage {
  id: string
  role: Role
  content: string
  reasoning?: string
  // Alternate assistant generations. content/reasoning mirror swipes[swipeIndex].
  swipes?: Swipe[]
  swipeIndex?: number
  error?: boolean
  createdAt: number
}

export type ResponseLength = 'short' | 'medium' | 'long'

// Only off/full are honest here: this model's reasoning balloons with context and
// reasoning_effort/think-levels don't reliably bound it (verified), so there's no
// dependable "a little reasoning" middle ground.
export type ThinkMode = 'off' | 'full'

export interface ChatTuning {
  prose: number // 0 = all dialogue … 100 = all prose/description
  length: ResponseLength
  intensity: number // 1 … 5
  think: ThinkMode // off = no reasoning (fast); full = reasons first (slow, balloons in long chats)
}

export interface Chat {
  id: string
  characterId: string // primary character (sidebar avatar/title) — always castIds[0]
  castIds: string[] // all characters sharing this chat's single context
  mutedIds: string[] // in context but not voiced
  title: string
  scenePrompt: string // this session's opening scene (set per-chat, not per-character)
  started: boolean // false = still in the setup panel
  tuning: ChatTuning
  portraitSetId?: string // which of the primary character's portrait sets the live portrait shows
  autoPortraitSet?: boolean // let the model pick the active look each reply (matches the scene to a set's description)
  sources: Source[] // reference docs injected into context
  knowledgeFolder?: string // path to a user-granted folder; relevant chunks retrieved into context per message
  summary: string // rolling distilled "story so far" memory of older, summarized-out messages
  summarizedCount: number // count of leading messages folded into `summary` (not sent verbatim)
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

export interface Settings {
  baseUrl: string
  model: string
  temperature: number
  topP: number
  maxTokens: number // 0 = unlimited (recommended for this reasoning model)
  contextLength: number
  autoExpandReasoning: boolean
  keepLoaded: boolean // pin the model in VRAM (keep_alive -1) instead of idle-unloading
  proofread: boolean // re-run each reply through the model to fix spelling/grammar
  seenTutorial: boolean // the "how it works" architecture modal has been shown
  seenWelcome: boolean // the first-run welcome tour was dismissed with "don't show again"
  theme: string // accent/void preset: penumbra | synthwave | cyber | ember | bloodmoon
  visionModel: string // '' = off, else a VISION_MODELS id — a vision-capable model for image tasks
  intentRouter: 'off' | 'quick' | 'full' // control-net: off | classify only action-like prompts | classify every prompt
  reduceMotion: boolean // accessibility: force-disable animations/transitions (also auto-on via OS prefers-reduced-motion)
  highContrast: boolean // accessibility: full-strength secondary text + stronger borders
  livePortraits?: boolean // show a large emotion-reactive character portrait above the chat
  livePortraitSize?: 'small' | 'medium' | 'large' // how big the live portrait stage is
  // advanced sampling — defaults match llama.cpp, so behavior is unchanged until tuned
  topK: number
  minP: number
  typicalP: number
  repeatPenalty: number
  repeatLastN: number
  presencePenalty: number
  frequencyPenalty: number
  mirostat: number
  mirostatTau: number
  mirostatEta: number
  dryMultiplier: number
  dryBase: number
  dryAllowedLength: number
  seed: number
}

export type AppView = 'chat' | 'story' | 'tree' | 'ask'

/** A reference document that sits in context (style/lore/facts) — like a text LoRA. */
export interface Source {
  id: string
  name: string
  text: string
}

/** A selectable "expert" — a named system-prompt rule set used by the Ask view. */
export interface Expert {
  id: string
  name: string
  emoji: string
  systemPrompt: string
  builtin?: boolean
  createdAt: number
}

/** A multi-turn "Ask Gemma" conversation, steered by a selected Expert. */
export interface Ask {
  id: string
  title: string
  expertId: string | null
  messages: ChatMessage[]
  think: boolean
  knowledgeFolder?: string // read/write folder: reference docs in, generated documents out
  createdAt: number
  updatedAt: number
}

// ---------- Story Mode (multi-character auto-play) ----------
export type BeatType = 'dialogue' | 'action' | 'narration'

export interface StoryBeat {
  id: string
  characterId: string | null // null = narrator
  speaker: string
  type: BeatType
  text: string
}

export type POV = '1st' | '2nd' | '3rd'

export interface StoryDials {
  setting: string
  tone: string[]
  genre: string
  pov: POV
  pacing: number // 0 (slow-burn) … 100 (fast)
  intensity: number // 1 … 5
  ending: string // optional desired ending direction
}

export interface Story {
  id: string
  title: string
  premise: string
  characterIds: string[]
  targetBeats: number // legacy; superseded by targetWords
  targetWords: number // desired length; generated in auto-continued passes
  dials: StoryDials
  steerLines: string[] // one-liner touchstones to push the scene toward
  flowCurve: number[] // length 10; 0 (all dialogue) … 100 (all description) per segment
  sources: Source[] // reference docs injected into context
  beats: StoryBeat[]
  createdAt: number
  updatedAt: number
}

// ---------- Dialogue Tree Mode (branching, game-ready) ----------
export interface DialogueOption {
  text: string // the player's choice
  next: string | null // child node id, or null = conversation ends
}

export interface DialogueNode {
  id: string
  speaker: string // NPC name
  line: string // NPC dialogue at this node
  options: DialogueOption[]
  depth: number
}

export interface DialogueTree {
  id: string
  title: string
  premise: string
  characterId: string | null
  npcName: string
  maxDepth: number
  maxBreadth: number
  rootId: string | null
  nodes: Record<string, DialogueNode>
  createdAt: number
  updatedAt: number
}
