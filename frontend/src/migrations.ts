// Save-format migrations: everything that reconciles an OLDER persisted store with the CURRENT
// shape lives here, out of store.ts. This is zustand-persist's `merge` — it runs on every boot,
// shallow-merging the persisted slices over the defaults and backfilling fields added since the
// save was written. Every block is idempotent: a fully-migrated save passes through unchanged.
import type { Character, Persona, Chat, ChatMessage, Settings, Story, ChatTuning, ThinkMode, Expert, Ask } from './types'
import { uid, now } from './util'
import {
  defaultCharacters,
  DEFAULT_DIALS,
  defaultFlowCurve,
  DEFAULT_TARGET_WORDS,
  DEFAULT_CHAT_TUNING,
  defaultExperts,
} from './seed'

/** The persisted data slices the migrations touch (the rest of the save passes through as-is). */
interface PersistedData {
  characters: Character[]
  persona: Persona
  chats: Chat[]
  settings: Settings
  stories: Story[]
  experts: Expert[]
  asks: Ask[]
}

/**
 * Merge a persisted save over the current defaults, migrating old shapes:
 * - stories: backfill targetWords/dials/steerLines/flowCurve/sources added after first save
 * - chats: castIds/mutedIds/scenePrompt/started/tuning (incl. legacy think values)/sources/summary
 * - experts: seed built-ins on first run; backfill newly shipped built-ins by id
 * - asks: migrate legacy single-shot {prompt,response} into multi-turn threads
 * - settings: deep-merge so new fields keep defaults; migrate the old Ollama dev-proxy baseUrl
 * - characters: backfill the shipped Seraphina example portraits onto installs that predate them
 */
export function mergePersisted<S extends PersistedData>(persisted: unknown, current: S): S {
  const p = (persisted ?? {}) as Partial<PersistedData>
  // Backfill story fields added after a story was first saved.
  const stories = (p.stories ?? current.stories).map((st) => ({
    ...st,
    targetWords: typeof st.targetWords === 'number' && st.targetWords > 0 ? st.targetWords : DEFAULT_TARGET_WORDS,
    dials: { ...DEFAULT_DIALS, ...(st.dials ?? {}) },
    steerLines: Array.isArray(st.steerLines) ? st.steerLines : [],
    flowCurve: Array.isArray(st.flowCurve) && st.flowCurve.length === 10 ? st.flowCurve : defaultFlowCurve(),
    sources: Array.isArray(st.sources) ? st.sources : [],
  }))
  // Backfill chat fields (scene moved out of the character into the chat).
  const chats = (p.chats ?? current.chats).map((c) => {
    const merged = { ...DEFAULT_CHAT_TUNING, ...((c.tuning ?? {}) as Partial<ChatTuning>) }
    const tk = merged.think as unknown // older saves stored a boolean or 'brief'
    const think: ThinkMode = tk === 'full' ? 'full' : 'off'
    return {
      ...c,
      castIds: Array.isArray(c.castIds) && c.castIds.length ? c.castIds : [c.characterId],
      mutedIds: Array.isArray(c.mutedIds) ? c.mutedIds : [],
      scenePrompt: typeof c.scenePrompt === 'string' ? c.scenePrompt : '',
      started: typeof c.started === 'boolean' ? c.started : (c.messages?.length ?? 0) > 0,
      tuning: { ...merged, think },
      sources: Array.isArray(c.sources) ? c.sources : [],
      summary: typeof c.summary === 'string' ? c.summary : '',
      summarizedCount: typeof c.summarizedCount === 'number' ? c.summarizedCount : 0,
    }
  })
  // Seed built-in experts on first run; backfill any newly shipped built-ins
  // (matched by id) into existing saves without disturbing the user's own
  // experts or their edits. (A deleted built-in reappears on next load.)
  const persistedExperts = Array.isArray(p.experts) ? p.experts : []
  const seenExpertIds = new Set(persistedExperts.map((e) => e.id))
  const experts = persistedExperts.length
    ? [...persistedExperts, ...defaultExperts.filter((e) => !seenExpertIds.has(e.id))]
    : defaultExperts
  // Migrate legacy single-shot asks ({prompt,response,reasoning}) into multi-turn threads.
  const asks = ((p.asks ?? current.asks) as unknown[]).map((raw) => {
    const any = (raw ?? {}) as Record<string, unknown>
    if (Array.isArray(any.messages)) {
      return {
        ...(raw as Ask),
        title: typeof any.title === 'string' ? (any.title as string) : '',
        expertId: typeof any.expertId === 'string' ? (any.expertId as string) : null,
        think: !!any.think,
      } as Ask
    }
    const prompt = typeof any.prompt === 'string' ? (any.prompt as string) : ''
    const response = typeof any.response === 'string' ? (any.response as string) : ''
    const msgs: ChatMessage[] = []
    if (prompt.trim()) msgs.push({ id: uid(), role: 'user', content: prompt, createdAt: (any.createdAt as number) ?? now() })
    if (response.trim())
      msgs.push({
        id: uid(),
        role: 'assistant',
        content: response,
        reasoning: typeof any.reasoning === 'string' ? (any.reasoning as string) : '',
        createdAt: (any.updatedAt as number) ?? now(),
      })
    return {
      id: (any.id as string) ?? uid(),
      title: prompt.slice(0, 60),
      expertId: null,
      messages: msgs,
      think: !!any.think,
      createdAt: (any.createdAt as number) ?? now(),
      updatedAt: (any.updatedAt as number) ?? now(),
    } as Ask
  })
  const mergedSettings = { ...current.settings, ...((p.settings ?? {}) as Partial<Settings>) }
  // Migrate the old Ollama dev-proxy URL to the bundled llama.cpp engine.
  if (!mergedSettings.baseUrl || mergedSettings.baseUrl.startsWith('/ollama')) {
    mergedSettings.baseUrl = current.settings.baseUrl
  }
  // Backfill the shipped Seraphina example portraits onto installs that predate them
  // (leave her alone once a user has given her their own portrait sets, or deleted her).
  const seraphinaSeed = defaultCharacters.find((c) => c.id === 'seed-seraphina')
  const characters = (p.characters ?? current.characters).map((c) =>
    c.id === 'seed-seraphina' && !c.portraitSets?.length && seraphinaSeed?.portraitSets?.length
      ? { ...c, portrait: c.portrait || seraphinaSeed.portrait, portraitSets: seraphinaSeed.portraitSets }
      : c,
  )
  return {
    ...current,
    ...p,
    characters,
    stories,
    chats,
    experts,
    asks,
    settings: mergedSettings,
    persona: { ...current.persona, ...(p.persona ?? {}) },
  }
}
