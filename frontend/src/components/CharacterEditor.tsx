import { useState } from 'react'
import { Modal } from './Modal'
import { useStore } from '../store'
import { generateCharacter, expandCharacterField } from '../generators'
import { cx } from '../util'
import { CharAvatar } from './CharAvatar'
import { fileToPortrait, GENERIC_PORTRAITS } from '../image'
import { EMOTIONS, buildEmotionArtPrompts } from '../emotion'
import type { Character, EmotionKey } from '../types'

const COLORS = ['#7c5cff', '#3fb6a8', '#ff6b8b', '#f5a623', '#4a90e2', '#9b59b6', '#2ecc71', '#e74c3c']

type Draft = Omit<Character, 'id' | 'createdAt'>
type TextField = 'description' | 'personality' | 'scenario' | 'exampleDialogue' | 'systemPrompt'

const blank = (): Draft => ({
  name: '',
  avatar: '🙂',
  color: '#7c5cff',
  description: '',
  personality: '',
  scenario: '',
  exampleDialogue: '',
  systemPrompt: '',
})

export function CharacterEditor({ editing, onClose }: { editing: Character | 'new'; onClose: () => void }) {
  const addCharacter = useStore((s) => s.addCharacter)
  const updateCharacter = useStore((s) => s.updateCharacter)
  const deleteCharacter = useStore((s) => s.deleteCharacter)
  const settings = useStore((s) => s.settings)
  const isNew = editing === 'new'
  const [c, setC] = useState<Draft>(isNew ? blank() : { ...(editing as Character) })
  const [criteria, setCriteria] = useState('')
  const [gen, setGen] = useState(false)
  const [genErr, setGenErr] = useState('')
  const [expanding, setExpanding] = useState<string | null>(null)

  const set = (k: keyof Draft, v: string) => setC((prev) => ({ ...prev, [k]: v }))
  const setPortrait = (v: string | undefined) => setC((prev) => ({ ...prev, portrait: v }))

  const [portraitBusy, setPortraitBusy] = useState(false)
  const [portraitErr, setPortraitErr] = useState('')

  const onPickPortrait = async (file?: File) => {
    if (!file) return
    setPortraitBusy(true)
    setPortraitErr('')
    try {
      setPortrait(await fileToPortrait(file))
    } catch (e) {
      setPortraitErr((e as { message?: string })?.message ?? 'Could not use that image.')
    } finally {
      setPortraitBusy(false)
    }
  }

  const [showPrompts, setShowPrompts] = useState(false)
  const [emotionBusy, setEmotionBusy] = useState<EmotionKey | null>(null)
  const [emotionErr, setEmotionErr] = useState('')

  const setEmotionPortrait = (key: EmotionKey, v: string | undefined) =>
    setC((prev) => {
      const portraits = { ...(prev.portraits || {}) }
      if (v) portraits[key] = v
      else delete portraits[key]
      return { ...prev, portraits }
    })

  const onPickEmotion = async (key: EmotionKey, file?: File) => {
    if (!file) return
    setEmotionBusy(key)
    setEmotionErr('')
    try {
      setEmotionPortrait(key, await fileToPortrait(file))
    } catch (e) {
      setEmotionErr((e as { message?: string })?.message ?? 'Could not use that image.')
    } finally {
      setEmotionBusy(null)
    }
  }

  const generate = async () => {
    if (!criteria.trim() || gen) return
    setGen(true)
    setGenErr('')
    try {
      const partial = await generateCharacter(criteria.trim(), settings)
      setC((prev) => ({ ...prev, ...partial }))
    } catch (e) {
      setGenErr((e as { message?: string })?.message ?? 'Generation failed.')
    } finally {
      setGen(false)
    }
  }

  const expand = async (key: TextField, label: string) => {
    if (expanding) return
    setExpanding(key)
    setGenErr('')
    try {
      const text = await expandCharacterField({ field: label, current: c[key], character: c, settings })
      if (text) setC((prev) => ({ ...prev, [key]: text }))
    } catch (e) {
      setGenErr((e as { message?: string })?.message ?? 'Expand failed.')
    } finally {
      setExpanding(null)
    }
  }

  const save = () => {
    if (!c.name.trim()) {
      alert('Name is required.')
      return
    }
    if (isNew) addCharacter(c)
    else updateCharacter((editing as Character).id, c)
    onClose()
  }

  const remove = () => {
    if (confirm(`Delete "${(editing as Character).name}" and all its chats?`)) {
      deleteCharacter((editing as Character).id)
      onClose()
    }
  }

  return (
    <Modal
      title={isNew ? 'New character' : `Edit ${(editing as Character).name}`}
      onClose={onClose}
      wide
      footer={
        <div className="row gap full">
          {!isNew && (
            <button className="btn danger" onClick={remove}>
              Delete
            </button>
          )}
          <div className="grow" />
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn" onClick={save}>
            Save
          </button>
        </div>
      }
    >
      <div className="form">
        <div className="gen-panel">
          <span className="gen-title">✨ Generate from criteria</span>
          <textarea
            value={criteria}
            rows={2}
            placeholder="e.g. a world-weary dwarven blacksmith who secretly forges weapons for the rebellion"
            onChange={(e) => setCriteria(e.target.value)}
          />
          <div className="row gap">
            <button className="btn sm" onClick={generate} disabled={gen || !criteria.trim()}>
              {gen ? 'Building…' : 'Generate character'}
            </button>
            <span className="muted xs">Fills the fields below — review and edit before saving.</span>
          </div>
        </div>

        <div className="row gap">
          <label className="field shrink">
            <span>Avatar</span>
            <input
              value={c.avatar}
              onChange={(e) => set('avatar', e.target.value)}
              maxLength={2}
              className="avatar-input"
            />
          </label>
          <label className="field grow">
            <span>Name</span>
            <input value={c.name} onChange={(e) => set('name', e.target.value)} placeholder="Character name" />
          </label>
        </div>

        <label className="field">
          <span className="field-head">
            <span>Portrait</span>
            <span className="muted xs">optional — falls back to the emoji tile</span>
          </span>
          <div className="row gap portrait-row">
            <CharAvatar avatar={c.avatar} color={c.color} portrait={c.portrait} name={c.name} />
            <label className={cx('btn sm ghost', portraitBusy && 'disabled')}>
              {portraitBusy ? 'Processing…' : '📁 Upload image'}
              <input
                type="file"
                accept="image/*"
                hidden
                disabled={portraitBusy}
                onChange={(e) => onPickPortrait(e.target.files?.[0])}
              />
            </label>
            {c.portrait && (
              <button type="button" className="btn sm ghost" onClick={() => setPortrait(undefined)}>
                Remove
              </button>
            )}
          </div>
          <div className="swatches portrait-swatches">
            {GENERIC_PORTRAITS.map((p) => (
              <button
                key={p}
                type="button"
                className={cx('swatch portrait-swatch', c.portrait === p && 'sel')}
                style={{ backgroundImage: `url("${p}")` }}
                title="Use a generic portrait"
                onClick={() => setPortrait(p)}
              />
            ))}
          </div>
          {portraitErr && <div className="error-line">{portraitErr}</div>}
        </label>

        <label className="field">
          <span className="field-head">
            <span>
              Living set <span className="muted xs">optional — emotion portraits for live mode</span>
            </span>
            <button type="button" className="btn xs ghost" onClick={() => setShowPrompts((s) => !s)}>
              ✨ Art prompts
            </button>
          </span>
          {showPrompts && (
            <div className="prompt-block">
              <div className="muted xs">
                Paste into an image generator to make a matched set for {c.name || 'this character'} — generate
                Neutral first, then reuse it as a reference so the rest stay consistent.
              </div>
              <textarea className="prompt-out" readOnly rows={12} value={buildEmotionArtPrompts(c)} />
              <button
                type="button"
                className="btn sm"
                onClick={() => navigator.clipboard?.writeText(buildEmotionArtPrompts(c))}
              >
                Copy prompts
              </button>
            </div>
          )}
          <div className="emotion-grid">
            {EMOTIONS.map((e) => {
              const src = e.key === 'neutral' ? c.portraits?.neutral ?? c.portrait : c.portraits?.[e.key]
              return (
                <div key={e.key} className="emotion-slot">
                  <div className="emotion-pic-wrap">
                    <label className="emotion-pic" title={`Upload ${e.label}`}>
                      <CharAvatar avatar={c.avatar} color={c.color} portrait={src} name={e.label} />
                      <input
                        type="file"
                        accept="image/*"
                        hidden
                        disabled={emotionBusy === e.key}
                        onChange={(ev) => onPickEmotion(e.key, ev.target.files?.[0])}
                      />
                    </label>
                    {c.portraits?.[e.key] && (
                      <button
                        type="button"
                        className="emotion-clear"
                        title={`Clear ${e.label}`}
                        onClick={() => setEmotionPortrait(e.key, undefined)}
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <span className="emotion-label">{emotionBusy === e.key ? '…' : e.label}</span>
                </div>
              )
            })}
          </div>
          {emotionErr && <div className="error-line">{emotionErr}</div>}
        </label>

        <label className="field">
          <span>Accent color</span>
          <div className="swatches">
            {COLORS.map((col) => (
              <button
                key={col}
                type="button"
                className={cx('swatch', c.color === col && 'sel')}
                style={{ background: col }}
                onClick={() => set('color', col)}
              />
            ))}
          </div>
        </label>

        <ExpandField
          label="Description (appearance, background)"
          rows={3}
          value={c.description}
          onChange={(v) => set('description', v)}
          onExpand={() => expand('description', 'description')}
          busy={expanding === 'description'}
          disabled={!!expanding}
        />
        <ExpandField
          label="Personality"
          rows={3}
          value={c.personality}
          onChange={(v) => set('personality', v)}
          onExpand={() => expand('personality', 'personality')}
          busy={expanding === 'personality'}
          disabled={!!expanding}
        />
        <ExpandField
          label="Backdrop / typical scenario"
          rows={2}
          value={c.scenario}
          onChange={(v) => set('scenario', v)}
          onExpand={() => expand('scenario', 'backdrop')}
          busy={expanding === 'scenario'}
          disabled={!!expanding}
        />
        <ExpandField
          label="Example dialogue"
          rows={3}
          value={c.exampleDialogue}
          onChange={(v) => set('exampleDialogue', v)}
          onExpand={() => expand('exampleDialogue', 'example dialogue')}
          busy={expanding === 'exampleDialogue'}
          disabled={!!expanding}
        />
        <ExpandField
          label="System prompt (extra steering)"
          rows={2}
          value={c.systemPrompt}
          onChange={(v) => set('systemPrompt', v)}
          onExpand={() => expand('systemPrompt', 'system prompt')}
          busy={expanding === 'systemPrompt'}
          disabled={!!expanding}
        />
        {genErr && <div className="error-line">{genErr}</div>}
      </div>
    </Modal>
  )
}

function ExpandField({
  label,
  value,
  onChange,
  rows,
  onExpand,
  busy,
  disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  rows: number
  onExpand: () => void
  busy: boolean
  disabled: boolean
}) {
  return (
    <label className="field">
      <span className="field-head">
        <span>{label}</span>
        <button type="button" className="btn xs ghost expand-btn" onClick={onExpand} disabled={disabled}>
          {busy ? 'expanding…' : '✨ Expand'}
        </button>
      </span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows} />
    </label>
  )
}
