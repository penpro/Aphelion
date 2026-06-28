import { useMemo, useState } from 'react'
import type { ChatMessage } from '../types'
import { Markdown } from './Markdown'
import { substituteMacros } from '../prompt'
import { detectReferences } from '../references'
import { cx } from '../util'

interface Props {
  message: ChatMessage
  charName: string
  userName: string
  avatar: string
  color: string
  autoExpandReasoning: boolean
  canRegenerate: boolean
  streaming: boolean
  onRegenerate: () => void
  onEdit: (text: string) => void
  onDelete: () => void
  onSwipe: (index: number) => void
  knownNames?: string[]
  creatingRef?: string | null
  onCreateReference?: (name: string, context: string) => void
}

export function MessageItem(props: Props) {
  const { message: m, charName, userName, avatar, color } = props
  const isUser = m.role === 'user'
  const name = isUser ? userName : charName
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(m.content)
  const [reasoningOpen, setReasoningOpen] = useState(props.autoExpandReasoning)

  const content = substituteMacros(m.content, charName, userName)
  const reasoning = m.reasoning ? substituteMacros(m.reasoning, charName, userName) : ''
  const swipeTotal = m.swipes?.length ?? 0
  const swipeIdx = m.swipeIndex ?? 0
  const references = useMemo(
    () => (props.knownNames && content ? detectReferences(content, props.knownNames) : []),
    [content, props.knownNames],
  )

  const saveEdit = () => {
    props.onEdit(draft)
    setEditing(false)
  }

  return (
    <div className={cx('msg', isUser ? 'msg-user' : 'msg-assistant', m.error && 'msg-error')}>
      <div className="msg-avatar" style={{ background: isUser ? '#444b5a' : color }}>
        {isUser ? '🧑' : avatar}
      </div>
      <div className="msg-body">
        <div className="msg-head">
          <span className="msg-name" style={{ color: isUser ? '#cdd3df' : color }}>
            {name}
          </span>
          {!isUser && swipeTotal > 1 && (
            <span className="swipe-nav">
              <button className="icon-btn sm" disabled={swipeIdx <= 0} onClick={() => props.onSwipe(swipeIdx - 1)}>
                ‹
              </button>
              {swipeIdx + 1}/{swipeTotal}
              <button
                className="icon-btn sm"
                disabled={swipeIdx >= swipeTotal - 1}
                onClick={() => props.onSwipe(swipeIdx + 1)}
              >
                ›
              </button>
            </span>
          )}
        </div>

        {reasoning && (
          <details
            className="reasoning"
            open={reasoningOpen}
            onToggle={(e) => setReasoningOpen((e.target as HTMLDetailsElement).open)}
          >
            <summary>💭 Reasoning</summary>
            <div className="reasoning-body">{reasoning}</div>
          </details>
        )}

        {editing ? (
          <div className="msg-edit">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={Math.min(24, draft.split('\n').length + 2)}
            />
            <div className="row gap">
              <button className="btn sm" onClick={saveEdit}>
                Save
              </button>
              <button className="btn sm ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : content ? (
          <Markdown>{content}</Markdown>
        ) : props.streaming ? (
          <div className="typing">▋</div>
        ) : (
          <div className="muted empty-msg">(empty — try regenerate)</div>
        )}

        {!editing && references.length > 0 && props.onCreateReference && (
          <div className="ref-chips">
            <span className="muted xs">New character?</span>
            {references.map((name) => (
              <button
                key={name}
                className="ref-chip"
                disabled={props.creatingRef === name}
                onClick={() => props.onCreateReference?.(name, content)}
                title={`Create "${name}" from this reference and add them to the chat`}
              >
                {props.creatingRef === name ? `creating ${name}…` : `✦ ${name}`}
              </button>
            ))}
          </div>
        )}

        {!editing && (
          <div className="msg-actions">
            {!isUser && props.canRegenerate && (
              <button className="icon-btn" title="Regenerate" onClick={props.onRegenerate}>
                ↻
              </button>
            )}
            <button
              className="icon-btn"
              title="Edit"
              onClick={() => {
                setDraft(m.content)
                setEditing(true)
              }}
            >
              ✎
            </button>
            <button className="icon-btn" title="Copy" onClick={() => navigator.clipboard?.writeText(content)}>
              ⧉
            </button>
            <button className="icon-btn" title="Delete" onClick={props.onDelete}>
              🗑
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
