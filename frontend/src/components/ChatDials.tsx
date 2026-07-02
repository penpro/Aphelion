import { useStore } from '../store'
import { SourcesPanel } from './SourcesPanel'
import { CharAvatar } from './CharAvatar'
import { TipLabel } from './InfoTip'
import { cx } from '../util'
import { useConfirm } from './ConfirmDialog'
import { EMPTY_SCENE, DEFAULT_STATS, STAT_KEYS } from '../api/classifiers'
import type { Chat, Character, ResponseLength, ThinkMode } from '../types'

const SCENE_KEYS = ['outfit', 'hair', 'emotion', 'pose', 'props', 'location'] as const

const LENGTHS: { id: ResponseLength; label: string }[] = [
  { id: 'short', label: 'Short' },
  { id: 'medium', label: 'Medium' },
  { id: 'long', label: 'Long' },
]
const INTENSITY = ['', 'Wholesome', 'Mild', 'Suggestive', 'Steamy', 'Explicit']

/** The right-hand chat panel, grouped by concern: Cast · Sources · Style · Portrait · Scene.
 *  Each group folds; helper prose lives behind ⓘ tips so the panel stays scannable. The whole
 *  panel docks away via the edge handle in ChatView (settings.dialsCollapsed), and the same
 *  handle drags to resize it (width/resizing come from ChatView's splitter logic). */
export function ChatDials({ chat, width, resizing }: { chat: Chat; width?: number; resizing?: boolean }) {
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
  const who = primary?.name || 'the character'

  return (
    <aside
      className={cx('chat-dials', settings.dialsCollapsed && 'is-docked', resizing && 'is-resizing')}
      // Inline width only while open — when docked, the .is-docked class must win to collapse to 0.
      style={settings.dialsCollapsed || !width ? undefined : { width, flexBasis: width }}
    >
      <details className="dials-sec" open>
        <summary className="dials-title">Cast · {cast.length}</summary>
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
      </details>

      <details className="dials-sec">
        <summary className="dials-title">Sources{chat.sources.length || chat.knowledgeFolder ? ` · ${chat.sources.length + (chat.knowledgeFolder ? 1 : 0)}` : ''}</summary>
        <SourcesPanel
          sources={chat.sources}
          onChange={(s) => updateChat(chat.id, { sources: s })}
          folder={chat.knowledgeFolder}
          onSetFolder={(p) => updateChat(chat.id, { knowledgeFolder: p ?? undefined })}
        />
      </details>

      <details className="dials-sec" open>
        <summary className="dials-title">Style</summary>

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
          <TipLabel
            text="Thinking"
            tip="Off = no reasoning — fast, and stays snappy as the chat grows. Full = the model reasons before each reply; can help on tricky moments, but slows down a lot in long chats."
          />
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
        </div>
      </details>

      <details className="dials-sec" open>
        <summary className="dials-title">Portrait</summary>

        <div className="field">
          <TipLabel
            text="Live portrait"
            tip={`Reads each reply's mood and shows ${who}'s matching portrait, enlarged, above the chat. Needs a portrait set (or an analyzed smart-portrait folder) on the character.`}
          />
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

        {settings.livePortraits && !!primary?.portraitIndex?.length && (
          <div className="field">
            <span className="muted xs">
              ✨ Smart portraits — auto-picking from {who}’s analyzed folder ({primary.portraitIndex.length} indexed).
            </span>
          </div>
        )}

        {settings.livePortraits && !primary?.portraitIndex?.length && primarySets.length > 1 && (
          <div className="field">
            <TipLabel
              text="Portrait set"
              tip={`Which of ${who}’s looks the live portrait shows. Auto-switch lets the story pick the look as it moves (each set needs a description — type one or use “Describe looks” in the character editor).`}
            />
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
            <label className="row gap" style={{ marginTop: 8, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={!!chat.autoPortraitSet}
                onChange={(e) => updateChat(chat.id, { autoPortraitSet: e.target.checked })}
              />
              <span className="muted xs">Auto-switch looks</span>
            </label>
          </div>
        )}
      </details>

      <details className="dials-sec" open>
        <summary className="dials-title">Scene</summary>

        <div className="field">
          <TipLabel
            text="Scene memory"
            tip={`Deliberately carries the scene (outfit, hair, pose, props, location) AND ${who}'s internal stats (arousal, trust, anger, …) from turn to turn — anchors attitude, keeps the story consistent, and gives the live portrait exact tags to match. One small model call per reply.`}
          />
          <div className="seg fill">
            {[false, true].map((on) => (
              <button
                key={String(on)}
                type="button"
                className={cx('seg-btn', (chat.sceneTracking !== false) === on && 'sel')}
                onClick={() => updateChat(chat.id, { sceneTracking: on })}
              >
                {on ? 'On' : 'Off'}
              </button>
            ))}
          </div>
        </div>

        {chat.sceneTracking !== false && (
          <div className="field">
            <TipLabel
              text={`Current scene${chat.sceneState ? '' : ' — fills in after the next reply'}`}
              tip="Live — the model updates these each reply, the next reply and portrait pick use them. Edit any field to correct or steer."
            />
            {chat.sceneState && (
              <>
                {SCENE_KEYS.map((k) => (
                  <label key={k} className="scene-row">
                    <span className="scene-k">{k}</span>
                    <input
                      value={chat.sceneState![k]}
                      placeholder="—"
                      onChange={(e) =>
                        updateChat(chat.id, { sceneState: { ...(chat.sceneState ?? EMPTY_SCENE), [k]: e.target.value } })
                      }
                    />
                  </label>
                ))}
              </>
            )}
            {chat.characterStats && (
              <details className="stats-view">
                <summary className="muted xs">{who}’s stats</summary>
                {STAT_KEYS.map((k) => (
                  <label key={k} className="stat-row">
                    <span className="stat-k">{k}</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={chat.characterStats![k]}
                      onChange={(e) =>
                        updateChat(chat.id, {
                          characterStats: { ...(chat.characterStats ?? DEFAULT_STATS), [k]: Number(e.target.value) },
                        })
                      }
                    />
                    <span className="stat-v">{chat.characterStats![k]}</span>
                  </label>
                ))}
              </details>
            )}
          </div>
        )}

        <div className="field">
          <TipLabel
            text="Earned actions"
            tip={`On — your messages can't act for ${who}: writing “she takes off her dress” is treated as a wish, not an event; their actions must be earned. Off — your prose can narrate ${who}'s actions directly (director mode).`}
          />
          <div className="seg fill">
            {[false, true].map((on) => (
              <button
                key={String(on)}
                type="button"
                className={cx('seg-btn', !!chat.autonomy === on && 'sel')}
                onClick={() => updateChat(chat.id, { autonomy: on })}
              >
                {on ? 'On' : 'Off'}
              </button>
            ))}
          </div>
        </div>
      </details>
    </aside>
  )
}
