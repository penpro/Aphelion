export type Role = 'user' | 'assistant' | 'system'

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
  sources: Source[] // reference docs injected into context
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
  seenTutorial: boolean // the first-run tutorial has been shown
  theme: string // accent/void preset: penumbra | synthwave | cyber | ember | bloodmoon
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
