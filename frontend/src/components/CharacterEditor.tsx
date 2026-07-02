import { useRef, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { Modal } from './Modal'
import { useStore } from '../store'
import { useConfirm } from './ConfirmDialog'
import { generateCharacter, expandCharacterField } from '../generators'
import { cx, uid } from '../util'
import { CharAvatar } from './CharAvatar'
import { fileToPortrait, GENERIC_PORTRAITS } from '../image'
import { persistPortrait, portraitDataUrl, deleteDiskPortraits, deleteDroppedPortraits } from '../portraits'
import { EMOTIONS, buildEmotionArtPrompts } from '../emotion'
import { describePortrait, tagPortrait, getEngineStatus } from '../api/ollama'
import { setVisionMode, listImages, readImageData } from '../tauri'
import { findVisionModel } from '../visionModels'
import type { Character, EmotionKey, PortraitSet, PortraitIndexEntry } from '../types'

const baseName = (p: string) => p.split(/[\\/]/).filter(Boolean).pop() || p

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
  const confirm = useConfirm()
  const isNew = editing === 'new'
  const [c, setC] = useState<Draft>(() => {
    if (isNew) return blank()
    const e = { ...(editing as Character) } as Draft
    // migrate a legacy single living set into a named set so it shows up in the sets manager
    if (!e.portraitSets?.length && e.portraits && Object.keys(e.portraits).length) {
      e.portraitSets = [{ id: uid(), name: 'Set 1', portraits: e.portraits }]
    }
    if (!e.portraitSets) e.portraitSets = []
    return e
  })
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
      setPortrait(await persistPortrait(await fileToPortrait(file)))
    } catch (e) {
      setPortraitErr((e as { message?: string })?.message ?? 'Could not use that image.')
    } finally {
      setPortraitBusy(false)
    }
  }

  const [showPrompts, setShowPrompts] = useState(false)
  const [emotionBusy, setEmotionBusy] = useState<string | null>(null) // "setId:emotion"
  const [emotionErr, setEmotionErr] = useState('')

  const sets = c.portraitSets ?? []
  const [activeSetId, setActiveSetId] = useState<string | null>(sets[0]?.id ?? null)
  const activeSet = sets.find((s) => s.id === activeSetId) ?? sets[0] ?? null

  const mutateSets = (fn: (list: PortraitSet[]) => PortraitSet[]) =>
    setC((prev) => ({ ...prev, portraitSets: fn(prev.portraitSets ?? []) }))

  const addSet = () => {
    const s: PortraitSet = { id: uid(), name: `Set ${sets.length + 1}`, portraits: {} }
    mutateSets((list) => [...list, s])
    setActiveSetId(s.id)
    setShowPrompts(false)
  }
  const renameSet = (id: string, name: string) =>
    mutateSets((list) => list.map((s) => (s.id === id ? { ...s, name } : s)))
  const deleteSet = (id: string) => {
    mutateSets((list) => list.filter((s) => s.id !== id))
    if (activeSetId === id) setActiveSetId(sets.find((s) => s.id !== id)?.id ?? null)
  }
  const setSetEmotion = (setId: string, key: EmotionKey, v: string | undefined) =>
    mutateSets((list) =>
      list.map((s) => {
        if (s.id !== setId) return s
        const portraits = { ...s.portraits }
        if (v) portraits[key] = v
        else delete portraits[key]
        return { ...s, portraits }
      }),
    )

  const onPickSetEmotion = async (setId: string, key: EmotionKey, file?: File) => {
    if (!file) return
    setEmotionBusy(`${setId}:${key}`)
    setEmotionErr('')
    try {
      setSetEmotion(setId, key, await persistPortrait(await fileToPortrait(file)))
    } catch (e) {
      setEmotionErr((e as { message?: string })?.message ?? 'Could not use that image.')
    } finally {
      setEmotionBusy(null)
    }
  }

  const setSetDescription = (setId: string, description: string) =>
    mutateSets((list) => list.map((s) => (s.id === setId ? { ...s, description } : s)))

  const [scanPhase, setScanPhase] = useState('')
  const [scanErr, setScanErr] = useState('')
  const vm = findVisionModel(settings.visionModel)

  const waitEngineReady = async () => {
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 1500))
      try {
        if ((await getEngineStatus(settings.baseUrl)) === 'ready') return
      } catch {
        /* keep waiting */
      }
    }
    throw new Error('Engine did not come back up.')
  }

  // Load the vision model once, describe each set's look from a representative portrait, then restore
  // the main model. Fills every set's description (typed or scanned) — that's what drives auto-switch.
  const describeLooks = async () => {
    if (scanPhase) return
    setScanErr('')
    if (!vm) return setScanErr('Pick a vision model in Settings (the gear) first.')
    const targets = (c.portraitSets ?? []).filter((s) => Object.keys(s.portraits).length > 0)
    if (!targets.length) return setScanErr('Add at least one portrait to a set first.')
    const baseUrl = settings.baseUrl
    try {
      setScanPhase('Loading the vision model…')
      await setVisionMode(true, vm.textFile, vm.mmprojFile)
      await waitEngineReady()
      for (let i = 0; i < targets.length; i++) {
        const s = targets[i]
        setScanPhase(`Describing ${s.name?.trim() || 'look'} (${i + 1}/${targets.length})…`)
        const rep = s.portraits.neutral ?? Object.values(s.portraits)[0]
        const dataUrl = await portraitDataUrl(rep)
        if (!dataUrl) continue
        const desc = await describePortrait(baseUrl, dataUrl, c.name)
        if (desc) setSetDescription(s.id, desc)
      }
      setScanPhase('Restoring your main model…')
      await setVisionMode(false, vm.textFile, vm.mmprojFile)
      await waitEngineReady()
      setScanPhase('')
    } catch (e) {
      setScanErr((e as { message?: string })?.message ?? String(e))
      try {
        await setVisionMode(false, vm.textFile, vm.mmprojFile)
        await waitEngineReady()
      } catch {
        /* best effort restore */
      }
      setScanPhase('')
    }
  }

  // ---- Smart portraits: point at a folder, Analyze once, and the model handles the rest ----
  const [analyzePhase, setAnalyzePhase] = useState('')
  const [analyzeErr, setAnalyzeErr] = useState('')
  const stopAnalyzeRef = useRef(false)
  const visionBusy = !!scanPhase || !!analyzePhase // one vision job at a time (they swap the loaded model)

  const pickPortraitFolder = async () => {
    try {
      const d = await open({ directory: true, multiple: false, title: "Choose this character's portrait folder" })
      if (typeof d === 'string') setC((prev) => ({ ...prev, portraitFolder: d, portraitIndex: undefined }))
    } catch {
      /* cancelled */
    }
  }
  const clearSmartPortraits = () => setC((prev) => ({ ...prev, portraitFolder: undefined, portraitIndex: undefined }))

  // Load the vision model once, tag EVERY image in the folder with keywords (emotion/outfit/pose),
  // store the index on the character, then restore the main model. The user never types a
  // description — that's the model's job. Stop keeps whatever's been indexed so far.
  const analyzeFolder = async () => {
    if (visionBusy) return
    setAnalyzeErr('')
    const folder = c.portraitFolder
    if (!folder) return setAnalyzeErr('Choose a folder first.')
    if (!vm) return setAnalyzeErr('Pick a vision model in Settings (the gear) first.')
    stopAnalyzeRef.current = false
    try {
      setAnalyzePhase('Loading the vision model…')
      await setVisionMode(true, vm.textFile, vm.mmprojFile)
      await waitEngineReady()
      const names = await listImages(folder)
      if (!names.length) throw new Error('No images found in that folder.')
      const entries: PortraitIndexEntry[] = []
      for (let i = 0; i < names.length; i++) {
        if (stopAnalyzeRef.current) break
        setAnalyzePhase(`Analyzing ${names[i]} (${i + 1}/${names.length})…`)
        try {
          const dataUrl = await readImageData(folder, names[i])
          const tags = await tagPortrait(settings.baseUrl, dataUrl, c.name)
          if (tags) entries.push({ file: names[i], tags })
        } catch {
          /* skip an unreadable image */
        }
      }
      setC((prev) => ({ ...prev, portraitIndex: entries }))
      setAnalyzePhase('Restoring your main model…')
      await setVisionMode(false, vm.textFile, vm.mmprojFile)
      await waitEngineReady()
      setAnalyzePhase('')
    } catch (e) {
      setAnalyzeErr((e as { message?: string })?.message ?? String(e))
      try {
        await setVisionMode(false, vm.textFile, vm.mmprojFile)
        await waitEngineReady()
      } catch {
        /* best effort restore */
      }
      setAnalyzePhase('')
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
    const payload: Draft = { ...c }
    // portraitSets supersedes the legacy single living set — drop it so we don't store it twice.
    // Must be an explicit undefined: updateCharacter MERGES patches, so a merely-absent key
    // would silently keep the old stored value.
    if (payload.portraitSets?.length) payload.portraits = undefined
    if (isNew) addCharacter(payload)
    else {
      // Clean up disk files for any portraits this save dropped (swapped images, cleared
      // slots, deleted sets). Save-time only — cancelling the editor never touches disk.
      deleteDroppedPortraits(editing as Character, payload)
      updateCharacter((editing as Character).id, payload)
    }
    onClose()
  }

  const remove = async () => {
    if (
      await confirm({
        title: 'Delete character?',
        message: `"${(editing as Character).name}" and all of its chats will be permanently deleted.`,
        confirmLabel: 'Delete',
      })
    ) {
      deleteDiskPortraits(editing as Character) // remove its portrait files along with it
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

        <div className="field">
          <span className="field-head">
            <span>
              Portrait sets{' '}
              <span className="muted xs">optional — named looks (e.g. “Hair up”), each with the 8 emotions</span>
            </span>
            <span className="row gap">
              {sets.length > 0 && (
                <button type="button" className="btn xs ghost" onClick={describeLooks} disabled={visionBusy} title="Use the vision model to describe each look — powers auto-switching in chat">
                  {scanPhase ? 'Scanning…' : '🔍 Describe looks'}
                </button>
              )}
              <button type="button" className="btn xs ghost" onClick={addSet}>
                + New set
              </button>
            </span>
          </span>
          {sets.length === 0 ? (
            <div className="muted sm set-empty">
              No portrait sets yet. Add one to give {c.name || 'this character'} emotion portraits for live mode.
            </div>
          ) : (
            <div className="sets">
              <div className="set-tabs" role="tablist">
                {sets.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    className={cx('set-tab', s.id === activeSet?.id && 'sel')}
                    onClick={() => setActiveSetId(s.id)}
                  >
                    {s.name?.trim() || 'Untitled'}
                  </button>
                ))}
              </div>
              {activeSet && (
                <div className="set-body">
                  <div className="row gap set-head">
                    <input
                      className="set-name-input"
                      value={activeSet.name}
                      placeholder="Set name (e.g. Hair up)"
                      onChange={(e) => renameSet(activeSet.id, e.target.value)}
                    />
                    <button type="button" className="btn xs ghost" onClick={() => setShowPrompts((p) => !p)}>
                      ✨ Art prompts
                    </button>
                    <button
                      type="button"
                      className="btn xs ghost danger"
                      onClick={async () => { if (await confirm({ title: 'Delete set?', message: `Delete the "${activeSet.name || 'Untitled'}" portrait set and its emotion images?`, confirmLabel: 'Delete' })) deleteSet(activeSet.id) }}
                    >
                      Delete
                    </button>
                  </div>
                  <label className="field set-desc-field">
                    <span className="muted xs">Look description — what this outfit/appearance is. Drives auto-switching in chat; type it or use “Describe looks”.</span>
                    <textarea
                      className="set-desc"
                      rows={2}
                      placeholder='e.g. "a red silk evening gown, hair down and loose"'
                      value={activeSet.description ?? ''}
                      onChange={(e) => setSetDescription(activeSet.id, e.target.value)}
                    />
                  </label>
                  {showPrompts && (
                    <div className="prompt-block">
                      <div className="muted xs">
                        Paste into an image generator to make a matched set for {c.name || 'this character'}
                        {activeSet.name?.trim() ? ` (${activeSet.name.trim()})` : ''} — generate Neutral first, then
                        reuse it as a reference so the rest stay consistent.
                      </div>
                      <textarea
                        className="prompt-out"
                        readOnly
                        rows={12}
                        value={buildEmotionArtPrompts(c, activeSet.name)}
                      />
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() => navigator.clipboard?.writeText(buildEmotionArtPrompts(c, activeSet.name))}
                      >
                        Copy prompts
                      </button>
                    </div>
                  )}
                  <div className="emotion-grid">
                    {EMOTIONS.map((e) => {
                      const src = activeSet.portraits[e.key]
                      const busyKey = `${activeSet.id}:${e.key}`
                      return (
                        <div key={e.key} className="emotion-slot">
                          <div className="emotion-pic-wrap">
                            <label className="emotion-pic" title={`Upload ${e.label}`}>
                              <CharAvatar avatar={c.avatar} color={c.color} portrait={src} name={e.label} />
                              <input
                                type="file"
                                accept="image/*"
                                hidden
                                disabled={emotionBusy === busyKey}
                                onChange={(ev) => onPickSetEmotion(activeSet.id, e.key, ev.target.files?.[0])}
                              />
                            </label>
                            {src && (
                              <button
                                type="button"
                                className="emotion-clear"
                                title={`Clear ${e.label}`}
                                onClick={() => setSetEmotion(activeSet.id, e.key, undefined)}
                              >
                                ×
                              </button>
                            )}
                          </div>
                          <span className="emotion-label">{emotionBusy === busyKey ? '…' : e.label}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
          {emotionErr && <div className="error-line">{emotionErr}</div>}
          {scanPhase && <div className="muted xs" style={{ marginTop: 6 }}>{scanPhase}</div>}
          {scanErr && <div className="error-line">{scanErr}</div>}
          {!vm && sets.length > 0 && (
            <div className="muted xs" style={{ marginTop: 4 }}>
              Tip: “Describe looks” needs a vision model (Settings → Vision). Or just type each look’s description above.
            </div>
          )}
        </div>

        <div className="field">
          <span className="field-head">
            <span>
              Smart portraits{' '}
              <span className="muted xs">optional — a folder of portraits the model picks from automatically</span>
            </span>
            {analyzePhase ? (
              <button type="button" className="btn xs ghost" onClick={() => { stopAnalyzeRef.current = true }}>
                ■ Stop
              </button>
            ) : (
              <button
                type="button"
                className="btn xs ghost"
                onClick={analyzeFolder}
                disabled={visionBusy || !c.portraitFolder}
                title="Vision-scan every image in the folder and index it — no typing required"
              >
                ✨ Analyze
              </button>
            )}
          </span>
          <div className="row gap" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
            {c.portraitFolder ? (
              <span className="muted sm" title={c.portraitFolder}>📁 {baseName(c.portraitFolder)}</span>
            ) : (
              <span className="muted sm">No folder chosen.</span>
            )}
            <button type="button" className="btn xs ghost" onClick={pickPortraitFolder} disabled={visionBusy}>
              {c.portraitFolder ? 'Change folder' : '📁 Choose folder'}
            </button>
            {!!c.portraitIndex?.length && (
              <span className="muted xs" style={{ color: 'var(--corona, #5EEAD4)' }}>
                ✓ {c.portraitIndex.length} portrait{c.portraitIndex.length === 1 ? '' : 's'} indexed
              </span>
            )}
            {(c.portraitFolder || c.portraitIndex?.length) && (
              <button type="button" className="btn xs ghost" onClick={clearSmartPortraits} disabled={visionBusy}>
                Clear
              </button>
            )}
          </div>
          {analyzePhase && <div className="muted xs" style={{ marginTop: 6 }}>{analyzePhase}</div>}
          {analyzeErr && <div className="error-line">{analyzeErr}</div>}
          <span className="muted xs" style={{ marginTop: 4 }}>
            Drop every look — outfits, poses, expressions — into one folder and hit Analyze. The vision model tags each
            image (it loads once, then your main model comes back), and in chat the live portrait auto-picks the best
            one as the story moves. Takes priority over portrait sets.
          </span>
        </div>

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
