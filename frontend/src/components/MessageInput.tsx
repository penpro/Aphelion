import { useState, type KeyboardEvent } from 'react'

export function MessageInput({
  disabled,
  streaming,
  onSend,
  onStop,
  onContinue,
}: {
  disabled: boolean
  streaming: boolean
  onSend: (text: string) => void
  onStop: () => void
  onContinue?: () => void // when set, an empty Enter/Send advances the scene
}) {
  const [text, setText] = useState('')

  const submit = () => {
    if (disabled) return
    const t = text.trim()
    if (t) {
      onSend(t)
      setText('')
    } else if (onContinue) {
      onContinue() // empty input → keep the scene going
    }
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const hasText = !!text.trim()

  return (
    <div className="composer">
      <textarea
        value={text}
        placeholder={
          onContinue
            ? 'Write a message…  (Enter to send · empty Enter to continue the scene · Shift+Enter = new line)'
            : 'Write a message…  (Enter to send · Shift+Enter for a new line · drag the corner to resize)'
        }
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        rows={2}
      />
      {streaming ? (
        <button className="btn stop" onClick={onStop} type="button">
          ■ Stop
        </button>
      ) : (
        <button
          className="btn send"
          onClick={submit}
          disabled={disabled || (!hasText && !onContinue)}
          title={!hasText && onContinue ? 'Continue the scene (or just press Enter)' : 'Send'}
          type="button"
        >
          {hasText || !onContinue ? 'Send' : 'Continue ▸'}
        </button>
      )}
    </div>
  )
}
