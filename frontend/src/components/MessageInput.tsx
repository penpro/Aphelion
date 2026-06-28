import { useState, type KeyboardEvent } from 'react'

export function MessageInput({
  disabled,
  streaming,
  onSend,
  onStop,
}: {
  disabled: boolean
  streaming: boolean
  onSend: (text: string) => void
  onStop: () => void
}) {
  const [text, setText] = useState('')

  const submit = () => {
    const t = text.trim()
    if (!t || disabled) return
    onSend(t)
    setText('')
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="composer">
      <textarea
        value={text}
        placeholder="Write a message…  (Enter to send · Shift+Enter for a new line · drag the corner to resize)"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        rows={2}
      />
      {streaming ? (
        <button className="btn stop" onClick={onStop} type="button">
          ■ Stop
        </button>
      ) : (
        <button className="btn send" onClick={submit} disabled={!text.trim() || disabled} type="button">
          Send
        </button>
      )}
    </div>
  )
}
