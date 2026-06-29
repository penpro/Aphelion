import { useStore } from '../store'
import { ModelBar } from './ModelBar'
import { CoronaMark } from './CoronaMark'
import { cx, timeAgo } from '../util'
import type { AppView, Character } from '../types'

const MODES: { id: AppView; label: string; icon: string }[] = [
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'story', label: 'Story', icon: '🎬' },
  { id: 'tree', label: 'Trees', icon: '🌳' },
  { id: 'ask', label: 'Ask', icon: '🪄' },
]

export function Sidebar({
  onEditCharacter,
  onNewCharacter,
  onOpenPersona,
  onOpenSettings,
  onOpenTutorial,
}: {
  onEditCharacter: (c: Character) => void
  onNewCharacter: () => void
  onOpenPersona: () => void
  onOpenSettings: () => void
  onOpenTutorial: () => void
}) {
  const view = useStore((s) => s.view)
  const setView = useStore((s) => s.setView)
  const characters = useStore((s) => s.characters)
  const chats = useStore((s) => s.chats)
  const stories = useStore((s) => s.stories)
  const trees = useStore((s) => s.trees)
  const activeChatId = useStore((s) => s.activeChatId)
  const activeStoryId = useStore((s) => s.activeStoryId)
  const activeTreeId = useStore((s) => s.activeTreeId)
  const persona = useStore((s) => s.persona)
  const startChat = useStore((s) => s.startChat)
  const openChat = useStore((s) => s.openChat)
  const deleteChat = useStore((s) => s.deleteChat)
  const addToCast = useStore((s) => s.addToCast)
  const createStory = useStore((s) => s.createStory)
  const openStory = useStore((s) => s.openStory)
  const deleteStory = useStore((s) => s.deleteStory)
  const createTree = useStore((s) => s.createTree)
  const openTree = useStore((s) => s.openTree)
  const deleteTree = useStore((s) => s.deleteTree)
  const asks = useStore((s) => s.asks)
  const activeAskId = useStore((s) => s.activeAskId)
  const createAsk = useStore((s) => s.createAsk)
  const openAsk = useStore((s) => s.openAsk)
  const deleteAsk = useStore((s) => s.deleteAsk)

  const openOrStart = (id: string) => {
    const existing = chats.filter((c) => c.characterId === id).sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (existing) openChat(existing.id)
    else startChat(id)
    setView('chat')
  }
  const charById = (id: string) => characters.find((c) => c.id === id)
  const sortedChats = [...chats].sort((a, b) => b.updatedAt - a.updatedAt)
  const sortedStories = [...stories].sort((a, b) => b.updatedAt - a.updatedAt)
  const sortedTrees = [...trees].sort((a, b) => b.updatedAt - a.updatedAt)
  const sortedAsks = [...asks].sort((a, b) => b.updatedAt - a.updatedAt)
  const activeChat = chats.find((c) => c.id === activeChatId) ?? null

  return (
    <aside className="sidebar">
      <div className="brand">
        <CoronaMark size={22} /> Aphelion
      </div>

      <ModelBar />

      <nav className="mode-nav">
        {MODES.map((m) => (
          <button key={m.id} className={cx('mode-btn', view === m.id && 'active')} onClick={() => setView(m.id)}>
            <span>{m.icon}</span>
            {m.label}
          </button>
        ))}
      </nav>

      <div className="side-section">
        <div className="side-head">
          <span>Characters</span>
          <button className="icon-btn" title="New character" onClick={onNewCharacter}>
            ＋
          </button>
        </div>
        <div className="char-list">
          {characters.map((c) => (
            <div key={c.id} className="char-row" onClick={() => openOrStart(c.id)}>
              <div className="msg-avatar sm" style={{ background: c.color }}>
                {c.avatar}
              </div>
              <div className="char-row-name">{c.name}</div>
              <button
                className="icon-btn sm row-action"
                title="New chat"
                onClick={(e) => {
                  e.stopPropagation()
                  startChat(c.id)
                  setView('chat')
                }}
              >
                ＋
              </button>
              {activeChat && activeChat.started && !activeChat.castIds.includes(c.id) && (
                <button
                  className="icon-btn sm row-action"
                  title={`Add ${c.name} to the open chat`}
                  onClick={(e) => {
                    e.stopPropagation()
                    addToCast(activeChat.id, c.id)
                    setView('chat')
                  }}
                >
                  ＋＋
                </button>
              )}
              <button
                className="icon-btn sm row-action"
                title="Edit"
                onClick={(e) => {
                  e.stopPropagation()
                  onEditCharacter(c)
                }}
              >
                ✎
              </button>
            </div>
          ))}
        </div>
      </div>

      {view === 'chat' && (
        <div className="side-section grow">
          <div className="side-head">
            <span>Chats</span>
          </div>
          <div className="chat-list">
            {sortedChats.length === 0 && <div className="muted sm pad">No chats yet.</div>}
            {sortedChats.map((c) => {
              const ch = charById(c.characterId)
              return (
                <div key={c.id} className={cx('chat-row', c.id === activeChatId && 'active')} onClick={() => openChat(c.id)}>
                  <div className="msg-avatar sm" style={{ background: ch?.color ?? '#555' }}>
                    {ch?.avatar ?? '?'}
                  </div>
                  <div className="chat-row-main">
                    <div className="chat-row-title">{c.title}</div>
                    <div className="muted xs">
                      {timeAgo(c.updatedAt)} · {c.messages.length} msgs
                    </div>
                  </div>
                  <button
                    className="icon-btn sm row-action"
                    title="Delete chat"
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteChat(c.id)
                    }}
                  >
                    🗑
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {view === 'story' && (
        <div className="side-section grow">
          <div className="side-head">
            <span>Stories</span>
            <button
              className="icon-btn"
              title="New story"
              onClick={() => createStory({ title: 'Untitled story', premise: '', characterIds: [], targetBeats: 12 })}
            >
              ＋
            </button>
          </div>
          <div className="chat-list">
            {sortedStories.length === 0 && <div className="muted sm pad">No stories yet.</div>}
            {sortedStories.map((s) => (
              <div key={s.id} className={cx('chat-row', s.id === activeStoryId && 'active')} onClick={() => openStory(s.id)}>
                <div className="msg-avatar sm" style={{ background: '#7c5cff' }}>
                  🎬
                </div>
                <div className="chat-row-main">
                  <div className="chat-row-title">{s.title}</div>
                  <div className="muted xs">
                    {timeAgo(s.updatedAt)} · {s.beats.length} beats
                  </div>
                </div>
                <button
                  className="icon-btn sm row-action"
                  title="Delete story"
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteStory(s.id)
                  }}
                >
                  🗑
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {view === 'tree' && (
        <div className="side-section grow">
          <div className="side-head">
            <span>Dialogue trees</span>
            <button
              className="icon-btn"
              title="New tree"
              onClick={() => createTree({ title: 'Untitled dialogue', premise: '', characterId: null, npcName: 'NPC', maxDepth: 2, maxBreadth: 3 })}
            >
              ＋
            </button>
          </div>
          <div className="chat-list">
            {sortedTrees.length === 0 && <div className="muted sm pad">No dialogue trees yet.</div>}
            {sortedTrees.map((t) => (
              <div key={t.id} className={cx('chat-row', t.id === activeTreeId && 'active')} onClick={() => openTree(t.id)}>
                <div className="msg-avatar sm" style={{ background: '#3fb6a8' }}>
                  🌳
                </div>
                <div className="chat-row-main">
                  <div className="chat-row-title">{t.title}</div>
                  <div className="muted xs">
                    {timeAgo(t.updatedAt)} · {Object.keys(t.nodes).length} nodes
                  </div>
                </div>
                <button
                  className="icon-btn sm row-action"
                  title="Delete tree"
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteTree(t.id)
                  }}
                >
                  🗑
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {view === 'ask' && (
        <div className="side-section grow">
          <div className="side-head">
            <span>Asks</span>
            <button className="icon-btn" title="New ask" onClick={() => createAsk()}>
              ＋
            </button>
          </div>
          <div className="chat-list">
            {sortedAsks.length === 0 && <div className="muted sm pad">No asks yet.</div>}
            {sortedAsks.map((a) => (
              <div key={a.id} className={cx('chat-row', a.id === activeAskId && 'active')} onClick={() => openAsk(a.id)}>
                <div className="msg-avatar sm" style={{ background: '#7c5cff' }}>
                  🪄
                </div>
                <div className="chat-row-main">
                  <div className="chat-row-title">{a.title?.trim() ? a.title.trim().slice(0, 44) : a.messages?.[0]?.content?.trim().slice(0, 44) || 'New ask'}</div>
                  <div className="muted xs">{timeAgo(a.updatedAt)}</div>
                </div>
                <button
                  className="icon-btn sm row-action"
                  title="Delete"
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteAsk(a.id)
                  }}
                >
                  🗑
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="side-foot">
        <button className="btn ghost block" onClick={onOpenTutorial}>
          ❔ How it works
        </button>
        <button className="btn ghost block" onClick={onOpenPersona}>
          🧑 Persona: {persona.name}
        </button>
        <button className="btn ghost block" onClick={onOpenSettings}>
          ⚙ Settings
        </button>
      </div>
    </aside>
  )
}
