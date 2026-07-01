import { useStore } from '../store'
import { SourcesPanel } from './SourcesPanel'
import { CharAvatar } from './CharAvatar'
import { cx } from '../util'
import { useConfirm } from './ConfirmDialog'
import type { Chat, Character, ResponseLength, ThinkMode } from '../types'

const LENGTHS: { id: ResponseLength; label: string }[] = [
  { id: 'short', label: 'Short' },
  { id: 'medium', label: 'Medium' },
  { id: 'long', label: 'Long' },
]
const INTENSITY = ['', 'Wholesome', 'Mild', 'Suggestive', 'Steamy', 'Explicit']

export function ChatDials({ chat }: { chat: Chat }) {
  const characters = useStore((s) => s.characters)
  const updateChat = useStore((s) => s.updateChat)
  const updateChatTuning = useStore((s) => s.updateChatTuning)
  const removeFromCast = useStore((s) => s.removeFromCast)
  const confirm = useConfirm()
  const toggleMute = useStore((s) => s.toggleMute)
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const t = chat.tuning
  const cast = chat.castIds.map((id) => characters.find((c) => c.id === id)).filter(Boolean) as Character[]
  const primary = cast[0] // the character shown on the live-portrait stage
  const primarySets = primary?.portraitSets ?? []

  return (
    <aside className="chat-dials">
      <div className="dials-section">
        <div className="dials-title">Cast · {cast.length}</div>
        <div className="cast-list">
          {cast.map((c) => {
            const muted = chat.mutedIds.includes(c.id)
            return (
              <div key={c.id} className={cx('cast-row', muted && 'is-muted')}>
                <CharAvatar avatar={c.avatar} color={c.color} portrait={c.portrait} name={c.name} small />
                <div className="cast-name">{c.name}</div>
                <button
                  className="icon-btn sm"
                  title={muted ? 'Unmute — let them speak' : 'Mute — keep in context but stop speaking'}
                  onClick={() => toggleMute(chat.id, c.id)}
                >
                  {muted ? '🔇' : '🔊'}
                </button>
                <button
                  className="icon-btn sm"
                  title="Remove from chat"
                  disabled={cast.length <= 1}
                  onClick={async () => {
                    if (await confirm({ title: 'Remove from chat?', message: `Remove ${c.name} from this chat? Their messages stay, but they'll no longer take part.`, confirmLabel: 'Remove' }))
                      removeFromCast(chat.id, c.id)
                  }}
                >
                  ✕
                </button>
              </div>
            )
          })}
        </div>
        <div className="muted xs">Add more with ＋＋ on a character in the sidebar.</div>
      </div>

      <div className="dials-section">
        <div className="dials-title">Sources</div>
        <SourcesPanel
          sources={chat.sources}
          onChange={(s) => updateChat(chat.id, { sources: s })}
          folder={chat.knowledgeFolder}
          onSetFolder={(p) => updateChat(chat.id, { knowledgeFolder: p ?? undefined })}
        />
      </div>

      <div className="dials-section">
        <div className="dials-title">Tuning</div>

        <div className="field">
          <span>Dialogue ↔ Prose</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={t.prose}
            onChange={(e) => updateChatTuning(chat.id, { prose: Number(e.target.value) })}
          />
          <div className="range-ends">
            <span>dialogue</span>
            <span>prose</span>
          </div>
        </div>

        <div className="field">
          <span>Response length</span>
          <div className="seg fill">
            {LENGTHS.map((l) => (
              <button
                key={l.id}
                type="button"
                className={cx('seg-btn', t.length === l.id && 'sel')}
                onClick={() => updateChatTuning(chat.id, { length: l.id })}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span>Intensity — {INTENSITY[t.intensity]}</span>
          <input
            type="range"
            min={1}
            max={5}
            step={1}
            value={t.intensity}
            onChange={(e) => updateChatTuning(chat.id, { intensity: Number(e.target.value) })}
          />
        </div>

        <div className="field">
          <span>Thinking</span>
          <div className="seg fill">
            {(['off', 'full'] as ThinkMode[]).map((m) => (
              <button
                key={m}
                type="button"
                className={cx('seg-btn', t.think === m && 'sel')}
                onClick={() => updateChatTuning(chat.id, { think: m })}
              >
                {m === 'off' ? 'Off' : 'Full'}
              </button>
            ))}
          </div>
          <span className="muted xs">
            {t.think === 'off'
              ? 'No reasoning — fast, and stays snappy as the chat grows.'
              : 'Full reasoning — can help on tricky moments, but slows down a lot in long chats.'}
          </span>
        </div>

        <div className="field">
          <span>Live portrait</span>
          <div className="seg fill">
            {[false, true].map((on) => (
              <button
                key={String(on)}
                type="button"
                className={cx('seg-btn', !!settings.livePortraits === on && 'sel')}
                onClick={() => updateSettings({ livePortraits: on })}
              >
                {on ? 'On' : 'Off'}
              </button>
            ))}
          </div>
          <span className="muted xs">
            Reads each reply's mood and shows the character's matching portrait, enlarged, above the chat. Needs a
            portrait set on the character.
          </span>
        </div>

        {settings.livePortraits && (
          <div className="field">
            <span>Portrait size</span>
            <div className="seg fill">
              {(['small', 'medium', 'large'] as const).map((sz) => (
                <button
                  key={sz}
                  type="button"
                  className={cx('seg-btn', (settings.livePortraitSize ?? 'small') === sz && 'sel')}
                  onClick={() => updateSettings({ livePortraitSize: sz })}
                >
                  {sz[0].toUpperCase() + sz.slice(1)}
                </button>
              ))}
            </div>
          </div>
        )}

        {settings.livePortraits && primarySets.length > 1 && (
          <div className="field">
            <span>Portrait set</span>
            <select
              className="set-select"
              value={primarySets.some((s) => s.id === chat.portraitSetId) ? chat.portraitSetId : primarySets[0].id}
              onChange={(e) => updateChat(chat.id, { portraitSetId: e.target.value })}
            >
              {primarySets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name?.trim() || 'Untitled'}
                </option>
              ))}
            </select>
            <span className="muted xs">Which of {primary?.name || 'the character'}’s looks the live portrait shows.</span>
            <label className="row gap" style={{ marginTop: 8, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={!!chat.autoPortraitSet}
                onChange={(e) => updateChat(chat.id, { autoPortraitSet: e.target.checked })}
              />
              <span className="muted xs">Auto-switch — let the story pick the look (needs a description on each set).</span>
            </label>
          </div>
        )}
      </div>
    </aside>
  )
}
