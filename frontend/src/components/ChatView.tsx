import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { useGeneration } from '../useGeneration'
import { MessageItem } from './MessageItem'
import { MessageInput } from './MessageInput'
import { ChatSetup } from './ChatSetup'
import { ChatDials } from './ChatDials'
import { Modal } from './Modal'
import { DocumentModal } from './DocumentModal'
import { substituteMacros } from '../prompt'
import { generateCharacterFromReference } from '../generators'
import { download } from '../util'
import type { Character } from '../types'

export function ChatView({ onEditCharacter }: { onEditCharacter: (c: Character) => void }) {
  const chats = useStore((s) => s.chats)
  const characters = useStore((s) => s.characters)
  const persona = useStore((s) => s.persona)
  const activeChatId = useStore((s) => s.activeChatId)
  const settings = useStore((s) => s.settings)
  const startChat = useStore((s) => s.startChat)
  const updateMessage = useStore((s) => s.updateMessage)
  const deleteMessage = useStore((s) => s.deleteMessage)
  const selectSwipe = useStore((s) => s.selectSwipe)
  const addCharacter = useStore((s) => s.addCharacter)
  const addToCast = useStore((s) => s.addToCast)
  const updateChat = useStore((s) => s.updateChat)

  const { isStreaming, memoryStatus, send, regenerate, begin, stop, continueScene } = useGeneration()
  const [creatingRef, setCreatingRef] = useState<string | null>(null)
  const [showMemory, setShowMemory] = useState(false)
  const [showDoc, setShowDoc] = useState(false)

  const chat = useMemo(() => chats.find((c) => c.id === activeChatId) ?? null, [chats, activeChatId])
  const character = useMemo(
    () => (chat ? (characters.find((c) => c.id === chat.characterId) ?? null) : null),
    [chat, characters],
  )
  const cast = useMemo(
    () => (chat ? (chat.castIds.map((id) => characters.find((c) => c.id === id)).filter(Boolean) as Character[]) : []),
    [chat, characters],
  )
  const knownNames = useMemo(
    () => [...cast.map((c) => c.name), persona.name, 'Narrator', 'Scene'],
    [cast, persona.name],
  )

  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [chat?.messages, isStreaming])

  if (!chat || !character) {
    return (
      <div className="chat empty-state">
        <div>
          <h1>🎭 Roleplay</h1>
          <p className="muted">Pick a character on the left to begin — or create a new one.</p>
        </div>
      </div>
    )
  }

  const isGroup = cast.length > 1
  const dispName = isGroup ? 'Scene' : character.name
  const dispAvatar = isGroup ? '🎭' : character.avatar
  const userName = persona.name
  const lastAssistantId = [...chat.messages].reverse().find((m) => m.role === 'assistant')?.id

  const createFromReference = async (name: string, context: string) => {
    if (creatingRef) return
    setCreatingRef(name)
    try {
      const partial = await generateCharacterFromReference({ name, context, settings })
      const created = addCharacter(partial as Omit<Character, 'id' | 'createdAt'>)
      addToCast(chat.id, created.id)
    } catch {
      /* ignore */
    } finally {
      setCreatingRef(null)
    }
  }

  const exportChat = () => {
    const lines = [`# ${chat.title}`, '', `_Cast: ${cast.map((c) => c.name).join(', ')}_`, '']
    if (chat.scenePrompt.trim()) lines.push(`> ${substituteMacros(chat.scenePrompt, character.name, userName)}`, '')
    for (const m of chat.messages) {
      const who = m.role === 'user' ? userName : m.role === 'assistant' ? dispName : 'System'
      lines.push(`**${who}:** ${substituteMacros(m.content, character.name, userName)}`, '')
    }
    download(`${chat.title.replace(/[^\w-]+/g, '_') || 'chat'}.md`, lines.join('\n'), 'text/markdown')
  }

  const header = (
    <header className="chat-head">
      <div className="chat-head-id">
        <div className="msg-avatar" style={{ background: character.color }}>
          {dispAvatar}
        </div>
        <div>
          <div className="chat-title">{isGroup ? cast.map((c) => c.name).join(', ') : character.name}</div>
          <div className="muted sm">
            {isGroup ? `${cast.length} characters · ` : ''}
            {chat.started ? `${chat.messages.length} messages` : 'new chat'}
          </div>
        </div>
      </div>
      <div className="row gap">
        <button className="btn sm ghost" onClick={() => startChat(character.id)}>
          + New chat
        </button>
        <button className="btn sm ghost" onClick={() => onEditCharacter(character)}>
          Edit character
        </button>
        <button className="btn sm ghost" onClick={exportChat} disabled={!chat.messages.length}>
          Export
        </button>
        <button className="btn sm ghost" onClick={() => setShowDoc(true)} title="Generate a document and compile it to a PDF">
          📄 Document
        </button>
        <button className="btn sm ghost" onClick={() => setShowMemory(true)} title="View / edit the rolling story memory">
          🧠 Memory
        </button>
      </div>
    </header>
  )

  const docModal = showDoc ? (
    <DocumentModal
      folder={chat.knowledgeFolder}
      onSetFolder={(p) => updateChat(chat.id, { knowledgeFolder: p ?? undefined })}
      defaultTitle={chat.title}
      transcript={{
        label: 'this chat',
        has: chat.messages.length > 0,
        build: () => {
          const lines: string[] = []
          if (chat.summary.trim()) lines.push(`Story so far: ${chat.summary.trim()}`, '')
          for (const m of chat.messages) {
            const who = m.role === 'user' ? userName : m.role === 'assistant' ? dispName : 'System'
            lines.push(`${who}: ${substituteMacros(m.content, character.name, userName)}`)
          }
          return lines.join('\n')
        },
      }}
      onClose={() => setShowDoc(false)}
    />
  ) : null

  if (!chat.started) {
    return (
      <div className="chat-shell">
        <div className="chat">
          {header}
          <ChatSetup chat={chat} character={character} persona={persona} onStart={() => begin(chat.id)} />
        </div>
        {docModal}
      </div>
    )
  }

  return (
    <div className="chat-shell">
      <div className="chat">
        {header}
        <div className="messages" ref={scrollRef}>
          {chat.messages.map((m) => (
            <MessageItem
              key={m.id}
              message={m}
              charName={dispName}
              userName={userName}
              avatar={dispAvatar}
              color={character.color}
              autoExpandReasoning={settings.autoExpandReasoning}
              canRegenerate={!isStreaming && m.id === lastAssistantId}
              streaming={isStreaming && m.id === lastAssistantId}
              onRegenerate={() => regenerate(chat.id, m.id)}
              onEdit={(text) => updateMessage(chat.id, m.id, { content: text })}
              onDelete={() => deleteMessage(chat.id, m.id)}
              onSwipe={(i) => selectSwipe(chat.id, m.id, i)}
              knownNames={knownNames}
              creatingRef={creatingRef}
              onCreateReference={createFromReference}
            />
          ))}
        </div>
        {memoryStatus && (
          <div style={{ padding: '4px 14px', fontSize: 12, opacity: 0.75 }}>{memoryStatus}</div>
        )}
        <MessageInput
          disabled={isStreaming}
          streaming={isStreaming}
          onSend={(text) => send(chat.id, text)}
          onStop={stop}
          onContinue={() => continueScene(chat.id)}
        />
      </div>
      <ChatDials chat={chat} />
      {docModal}
      {showMemory && (
        <Modal title="🧠 Story memory" onClose={() => setShowMemory(false)} wide>
          <p className="muted xs">
            A rolling summary of older events that have scrolled out of the live window
            {chat.summarizedCount > 0
              ? ` (${chat.summarizedCount} message${chat.summarizedCount === 1 ? '' : 's'} condensed so far)`
              : ''}
            . It's always kept in context. Edit it freely to correct or steer what the model remembers.
          </p>
          <textarea
            style={{ width: '100%', minHeight: 340, resize: 'vertical', fontFamily: 'inherit' }}
            value={chat.summary}
            placeholder="(No memory yet — it fills in automatically once the chat grows past the window.)"
            onChange={(e) => updateChat(chat.id, { summary: e.target.value })}
          />
        </Modal>
      )}
    </div>
  )
}
