import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  Character,
  Persona,
  Chat,
  ChatMessage,
  Settings,
  AppView,
  Story,
  StoryBeat,
  StoryDials,
  ChatTuning,
  ThinkMode,
  DialogueTree,
  DialogueNode,
  Expert,
  Ask,
} from './types'
import { uid, now } from './util'
import {
  defaultCharacters,
  defaultPersona,
  defaultSettings,
  DEFAULT_DIALS,
  defaultFlowCurve,
  DEFAULT_TARGET_WORDS,
  DEFAULT_CHAT_TUNING,
  defaultExperts,
} from './seed'

interface AppState {
  characters: Character[]
  persona: Persona
  chats: Chat[]
  activeChatId: string | null
  settings: Settings

  // characters
  addCharacter: (c: Omit<Character, 'id' | 'createdAt'>) => Character
  updateCharacter: (id: string, patch: Partial<Character>) => void
  deleteCharacter: (id: string) => void

  // persona + settings
  setPersona: (p: Persona) => void
  updateSettings: (patch: Partial<Settings>) => void

  // chats
  startChat: (characterId: string) => string
  openChat: (chatId: string) => void
  deleteChat: (chatId: string) => void
  renameChat: (chatId: string, title: string) => void
  updateChat: (chatId: string, patch: Partial<Chat>) => void
  updateChatTuning: (chatId: string, patch: Partial<ChatTuning>) => void
  addToCast: (chatId: string, characterId: string) => void
  removeFromCast: (chatId: string, characterId: string) => void
  toggleMute: (chatId: string, characterId: string) => void

  // messages
  addMessage: (chatId: string, msg: Omit<ChatMessage, 'id' | 'createdAt'>) => string
  appendToMessage: (chatId: string, msgId: string, patch: { content?: string; reasoning?: string }) => void
  updateMessage: (chatId: string, msgId: string, patch: Partial<ChatMessage>) => void
  deleteMessage: (chatId: string, msgId: string) => void

  // swipes (alternate generations)
  beginSwipe: (chatId: string, msgId: string) => void
  selectSwipe: (chatId: string, msgId: string, index: number) => void

  // view / navigation
  view: AppView
  setView: (v: AppView) => void

  // stories (multi-character auto-play)
  stories: Story[]
  activeStoryId: string | null
  createStory: (data: Pick<Story, 'title' | 'premise' | 'characterIds' | 'targetBeats'>) => string
  updateStory: (id: string, patch: Partial<Story>) => void
  updateDials: (id: string, patch: Partial<StoryDials>) => void
  deleteStory: (id: string) => void
  openStory: (id: string) => void
  addBeat: (storyId: string, beat: Omit<StoryBeat, 'id'>) => void
  setBeats: (storyId: string, beats: Omit<StoryBeat, 'id'>[]) => void
  clearBeats: (storyId: string) => void

  // dialogue trees (branching, game-ready)
  trees: DialogueTree[]
  activeTreeId: string | null
  createTree: (data: Pick<DialogueTree, 'title' | 'premise' | 'characterId' | 'npcName' | 'maxDepth' | 'maxBreadth'>) => string
  updateTree: (id: string, patch: Partial<DialogueTree>) => void
  deleteTree: (id: string) => void
  openTree: (id: string) => void
  resetTree: (id: string) => void
  setTreeRoot: (id: string, rootId: string) => void
  upsertNode: (id: string, node: DialogueNode) => void

  // experts (rule sets for the Ask view)
  experts: Expert[]
  addExpert: (e: Pick<Expert, 'name' | 'emoji' | 'systemPrompt'>) => Expert
  updateExpert: (id: string, patch: Partial<Expert>) => void
  deleteExpert: (id: string) => void

  // asks (multi-turn expert Q&A)
  asks: Ask[]
  activeAskId: string | null
  createAsk: () => string
  updateAsk: (id: string, patch: Partial<Ask>) => void
  deleteAsk: (id: string) => void
  openAsk: (id: string) => void
  addAskMessage: (askId: string, msg: Omit<ChatMessage, 'id' | 'createdAt'>) => string
  appendToAskMessage: (askId: string, msgId: string, patch: { content?: string; reasoning?: string }) => void
  updateAskMessage: (askId: string, msgId: string, patch: Partial<ChatMessage>) => void
  clearAskThread: (askId: string) => void
}

const touch = (c: Chat): Chat => ({ ...c, updatedAt: now() })

function mapMessage(
  state: AppState,
  chatId: string,
  msgId: string,
  fn: (m: ChatMessage) => ChatMessage,
): Partial<AppState> {
  return {
    chats: state.chats.map((c) =>
      c.id !== chatId ? c : touch({ ...c, messages: c.messages.map((m) => (m.id === msgId ? fn(m) : m)) }),
    ),
  }
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      characters: defaultCharacters,
      persona: defaultPersona,
      chats: [],
      activeChatId: null,
      settings: defaultSettings,

      addCharacter: (c) => {
        const created: Character = { ...c, id: uid(), createdAt: now() }
        set((s) => ({ characters: [...s.characters, created] }))
        return created
      },

      updateCharacter: (id, patch) =>
        set((s) => ({ characters: s.characters.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),

      deleteCharacter: (id) =>
        set((s) => {
          const chats = s.chats.filter((c) => c.characterId !== id)
          const activeChatId = chats.some((c) => c.id === s.activeChatId) ? s.activeChatId : null
          return { characters: s.characters.filter((c) => c.id !== id), chats, activeChatId }
        }),

      setPersona: (p) => set({ persona: p }),
      updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),

      startChat: (characterId) => {
        const character = get().characters.find((c) => c.id === characterId)
        const id = uid()
        const chat: Chat = {
          id,
          characterId,
          castIds: [characterId],
          mutedIds: [],
          title: character?.name ?? 'New chat',
          scenePrompt: '',
          started: false,
          tuning: { ...DEFAULT_CHAT_TUNING },
          sources: [],
          summary: '',
          summarizedCount: 0,
          messages: [],
          createdAt: now(),
          updatedAt: now(),
        }
        set((s) => ({ chats: [chat, ...s.chats], activeChatId: id }))
        return id
      },

      openChat: (chatId) => set({ activeChatId: chatId }),

      updateChat: (chatId, patch) =>
        set((s) => ({ chats: s.chats.map((c) => (c.id === chatId ? { ...c, ...patch, updatedAt: now() } : c)) })),
      updateChatTuning: (chatId, patch) =>
        set((s) => ({
          chats: s.chats.map((c) => (c.id === chatId ? { ...c, tuning: { ...c.tuning, ...patch }, updatedAt: now() } : c)),
        })),
      addToCast: (chatId, characterId) =>
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id !== chatId || c.castIds.includes(characterId)
              ? c
              : { ...c, castIds: [...c.castIds, characterId], updatedAt: now() },
          ),
        })),
      removeFromCast: (chatId, characterId) =>
        set((s) => ({
          chats: s.chats.map((c) => {
            if (c.id !== chatId) return c
            const castIds = c.castIds.filter((id) => id !== characterId)
            if (castIds.length === 0) return c // always keep at least one
            return {
              ...c,
              castIds,
              mutedIds: c.mutedIds.filter((id) => id !== characterId),
              characterId: castIds.includes(c.characterId) ? c.characterId : castIds[0],
              updatedAt: now(),
            }
          }),
        })),
      toggleMute: (chatId, characterId) =>
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id !== chatId
              ? c
              : {
                  ...c,
                  mutedIds: c.mutedIds.includes(characterId)
                    ? c.mutedIds.filter((id) => id !== characterId)
                    : [...c.mutedIds, characterId],
                  updatedAt: now(),
                },
          ),
        })),

      deleteChat: (chatId) =>
        set((s) => {
          const chats = s.chats.filter((c) => c.id !== chatId)
          return { chats, activeChatId: s.activeChatId === chatId ? (chats[0]?.id ?? null) : s.activeChatId }
        }),

      renameChat: (chatId, title) =>
        set((s) => ({ chats: s.chats.map((c) => (c.id === chatId ? { ...c, title } : c)) })),

      addMessage: (chatId, msg) => {
        const id = uid()
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id !== chatId ? c : touch({ ...c, messages: [...c.messages, { ...msg, id, createdAt: now() }] }),
          ),
        }))
        return id
      },

      appendToMessage: (chatId, msgId, patch) =>
        set((s) =>
          mapMessage(s, chatId, msgId, (m) => {
            const content = m.content + (patch.content ?? '')
            const reasoning = (m.reasoning ?? '') + (patch.reasoning ?? '')
            let swipes = m.swipes
            if (swipes && typeof m.swipeIndex === 'number') {
              swipes = swipes.map((sw, i) => (i === m.swipeIndex ? { content, reasoning } : sw))
            }
            return { ...m, content, reasoning, swipes }
          }),
        ),

      updateMessage: (chatId, msgId, patch) =>
        set((s) =>
          mapMessage(s, chatId, msgId, (m) => {
            const next = { ...m, ...patch }
            // Keep the active swipe in sync when editing content.
            if (patch.content !== undefined && next.swipes && typeof next.swipeIndex === 'number') {
              next.swipes = next.swipes.map((sw, i) =>
                i === next.swipeIndex ? { content: patch.content as string, reasoning: sw.reasoning } : sw,
              )
            }
            return next
          }),
        ),

      deleteMessage: (chatId, msgId) =>
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id !== chatId ? c : touch({ ...c, messages: c.messages.filter((m) => m.id !== msgId) }),
          ),
        })),

      beginSwipe: (chatId, msgId) =>
        set((s) =>
          mapMessage(s, chatId, msgId, (m) => {
            const existing = m.swipes ?? [{ content: m.content, reasoning: m.reasoning ?? '' }]
            const swipes = [...existing, { content: '', reasoning: '' }]
            return { ...m, swipes, swipeIndex: swipes.length - 1, content: '', reasoning: '', error: false }
          }),
        ),

      selectSwipe: (chatId, msgId, index) =>
        set((s) =>
          mapMessage(s, chatId, msgId, (m) => {
            if (!m.swipes || index < 0 || index >= m.swipes.length) return m
            const sw = m.swipes[index]
            return { ...m, swipeIndex: index, content: sw.content, reasoning: sw.reasoning }
          }),
        ),

      // ---- view / navigation ----
      view: 'chat',
      setView: (v) => set({ view: v }),

      // ---- stories ----
      stories: [],
      activeStoryId: null,
      createStory: (data) => {
        const id = uid()
        const story: Story = {
          ...data,
          id,
          targetWords: DEFAULT_TARGET_WORDS,
          dials: { ...DEFAULT_DIALS },
          steerLines: [],
          flowCurve: defaultFlowCurve(),
          sources: [],
          beats: [],
          createdAt: now(),
          updatedAt: now(),
        }
        set((s) => ({ stories: [story, ...s.stories], activeStoryId: id, view: 'story' }))
        return id
      },
      updateStory: (id, patch) =>
        set((s) => ({
          stories: s.stories.map((st) => (st.id === id ? { ...st, ...patch, updatedAt: now() } : st)),
        })),
      // Merge against the freshest dials so rapid sub-control changes never clobber each other.
      updateDials: (id, patch) =>
        set((s) => ({
          stories: s.stories.map((st) => (st.id === id ? { ...st, dials: { ...st.dials, ...patch }, updatedAt: now() } : st)),
        })),
      deleteStory: (id) =>
        set((s) => {
          const stories = s.stories.filter((st) => st.id !== id)
          return { stories, activeStoryId: s.activeStoryId === id ? (stories[0]?.id ?? null) : s.activeStoryId }
        }),
      openStory: (id) => set({ activeStoryId: id, view: 'story' }),
      addBeat: (storyId, beat) =>
        set((s) => ({
          stories: s.stories.map((st) =>
            st.id !== storyId ? st : { ...st, beats: [...st.beats, { ...beat, id: uid() }], updatedAt: now() },
          ),
        })),
      setBeats: (storyId, beats) =>
        set((s) => ({
          stories: s.stories.map((st) =>
            st.id === storyId ? { ...st, beats: beats.map((b) => ({ ...b, id: uid() })), updatedAt: now() } : st,
          ),
        })),
      clearBeats: (storyId) =>
        set((s) => ({
          stories: s.stories.map((st) => (st.id === storyId ? { ...st, beats: [], updatedAt: now() } : st)),
        })),

      // ---- dialogue trees ----
      trees: [],
      activeTreeId: null,
      createTree: (data) => {
        const id = uid()
        const tree: DialogueTree = { ...data, id, rootId: null, nodes: {}, createdAt: now(), updatedAt: now() }
        set((s) => ({ trees: [tree, ...s.trees], activeTreeId: id, view: 'tree' }))
        return id
      },
      updateTree: (id, patch) =>
        set((s) => ({ trees: s.trees.map((t) => (t.id === id ? { ...t, ...patch, updatedAt: now() } : t)) })),
      deleteTree: (id) =>
        set((s) => {
          const trees = s.trees.filter((t) => t.id !== id)
          return { trees, activeTreeId: s.activeTreeId === id ? (trees[0]?.id ?? null) : s.activeTreeId }
        }),
      openTree: (id) => set({ activeTreeId: id, view: 'tree' }),
      resetTree: (id) =>
        set((s) => ({
          trees: s.trees.map((t) => (t.id === id ? { ...t, rootId: null, nodes: {}, updatedAt: now() } : t)),
        })),
      setTreeRoot: (id, rootId) =>
        set((s) => ({ trees: s.trees.map((t) => (t.id === id ? { ...t, rootId, updatedAt: now() } : t)) })),
      upsertNode: (id, node) =>
        set((s) => ({
          trees: s.trees.map((t) =>
            t.id === id ? { ...t, nodes: { ...t.nodes, [node.id]: node }, updatedAt: now() } : t,
          ),
        })),

      // ---- experts (rule sets for the Ask view) ----
      experts: defaultExperts,
      addExpert: (e) => {
        const created: Expert = { ...e, id: uid(), createdAt: now() }
        set((s) => ({ experts: [...s.experts, created] }))
        return created
      },
      updateExpert: (id, patch) =>
        set((s) => ({ experts: s.experts.map((e) => (e.id === id ? { ...e, ...patch } : e)) })),
      deleteExpert: (id) =>
        set((s) => ({
          experts: s.experts.filter((e) => e.id !== id),
          asks: s.asks.map((a) => (a.expertId === id ? { ...a, expertId: null } : a)),
        })),

      // ---- asks (multi-turn expert Q&A) ----
      asks: [],
      activeAskId: null,
      createAsk: () => {
        const id = uid()
        const expertId = get().experts[0]?.id ?? null
        const ask: Ask = { id, title: '', expertId, messages: [], think: false, createdAt: now(), updatedAt: now() }
        set((s) => ({ asks: [ask, ...s.asks], activeAskId: id, view: 'ask' }))
        return id
      },
      updateAsk: (id, patch) =>
        set((s) => ({ asks: s.asks.map((a) => (a.id === id ? { ...a, ...patch, updatedAt: now() } : a)) })),
      deleteAsk: (id) =>
        set((s) => {
          const asks = s.asks.filter((a) => a.id !== id)
          return { asks, activeAskId: s.activeAskId === id ? (asks[0]?.id ?? null) : s.activeAskId }
        }),
      openAsk: (id) => set({ activeAskId: id, view: 'ask' }),
      addAskMessage: (askId, msg) => {
        const id = uid()
        set((s) => ({
          asks: s.asks.map((a) =>
            a.id !== askId ? a : { ...a, messages: [...a.messages, { ...msg, id, createdAt: now() }], updatedAt: now() },
          ),
        }))
        return id
      },
      appendToAskMessage: (askId, msgId, patch) =>
        set((s) => ({
          asks: s.asks.map((a) =>
            a.id !== askId
              ? a
              : {
                  ...a,
                  messages: a.messages.map((m) =>
                    m.id !== msgId
                      ? m
                      : {
                          ...m,
                          content: m.content + (patch.content ?? ''),
                          reasoning: (m.reasoning ?? '') + (patch.reasoning ?? ''),
                        },
                  ),
                  updatedAt: now(),
                },
          ),
        })),
      updateAskMessage: (askId, msgId, patch) =>
        set((s) => ({
          asks: s.asks.map((a) =>
            a.id !== askId
              ? a
              : { ...a, messages: a.messages.map((m) => (m.id === msgId ? { ...m, ...patch } : m)), updatedAt: now() },
          ),
        })),
      clearAskThread: (askId) =>
        set((s) => ({ asks: s.asks.map((a) => (a.id === askId ? { ...a, messages: [], title: '', updatedAt: now() } : a)) })),
    }),
    {
      name: 'localllm-roleplay-studio',
      version: 1,
      partialize: (s) => ({
        characters: s.characters,
        persona: s.persona,
        chats: s.chats,
        activeChatId: s.activeChatId,
        settings: s.settings,
        view: s.view,
        stories: s.stories,
        activeStoryId: s.activeStoryId,
        trees: s.trees,
        activeTreeId: s.activeTreeId,
        experts: s.experts,
        asks: s.asks,
        activeAskId: s.activeAskId,
      }),
      // Shallow-merge persisted over defaults, but deep-merge settings/persona so
      // newly added fields keep their defaults across versions.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>
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
        return {
          ...current,
          ...p,
          stories,
          chats,
          experts,
          asks,
          settings: mergedSettings,
          persona: { ...current.persona, ...(p.persona ?? {}) },
        }
      },
    },
  ),
)
