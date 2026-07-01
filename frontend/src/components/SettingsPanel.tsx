import { useState, type ReactNode } from 'react'
import { Modal } from './Modal'
import { useStore } from '../store'
import { friendlyModelName } from '../models'
import { defaultSettings } from '../seed'
import { VisionSettings } from './VisionSettings'
import { ModelsModal } from './ModelsModal'
import { UpdateCheck } from './UpdateCheck'
import { useConfirm } from './ConfirmDialog'
import { STORE_KEY, exportData } from '../storage'
import { cx, download } from '../util'

type Tip = { body: string; low?: string; high?: string }

// In-depth, A/B-style explanations for every sampler.
const TIP: Record<string, Tip> = {
  intentRouter: {
    body: 'The "control net": it reads your Ask prompt and, when it recognizes a task the app can do — find images → PDF, generate a document, edit a file, answer from your folder — offers a one-click action instead of just chatting. Nothing ever runs until you click it.',
    low: 'Off · never classify. Quick · only classify prompts that look like a task (a fast keyword pre-filter), so normal chat stays instant.',
    high: 'Full · classify every prompt through the model. Most thorough at catching intent, but adds a short beat before each send.',
  },
  temperature: {
    body: 'The master randomness dial — scales how sharply the model favors its most-likely next token.',
    low: '0.2 · focused, consistent, near-deterministic. Best for code and facts; can get repetitive.',
    high: '1.3 · inventive and varied. Best for creative writing; can wander or go incoherent.',
  },
  topP: {
    body: 'Nucleus sampling — only consider the smallest set of tokens whose probabilities add up to P.',
    low: '0.5 · safe, predictable word choices.',
    high: '1.0 · allows rare words; more surprising phrasing.',
  },
  topK: {
    body: 'Only sample from the K most-likely tokens. A hard cap on the candidate pool. 0 = disabled.',
    low: '20 · tight and on-rails.',
    high: '0 / 100 · no real cap; full distribution.',
  },
  minP: {
    body: 'Drop any token less likely than P× the top token. A cleaner modern alternative to top-p / top-k.',
    low: '0.01 · keep almost everything.',
    high: '0.1+ · aggressively prune unlikely tokens for coherence.',
  },
  typicalP: {
    body: 'Locally-typical sampling — favor tokens with average (not just peak) information. 1.0 = off.',
    low: '0.9 · more human-typical, fewer extremes.',
    high: '1.0 · disabled (no effect).',
  },
  repeatPenalty: {
    body: 'Penalize tokens that appeared recently, to curb loops. 1.0 = off.',
    low: '1.0 · no penalty.',
    high: '1.2+ · strongly discourages repeats; too high hurts grammar.',
  },
  repeatLastN: {
    body: 'How many recent tokens the repeat / presence / frequency penalties look back over.',
    low: '0 · disabled.',
    high: '256+ · penalize across a wide window.',
  },
  presencePenalty: {
    body: 'Flat penalty for any token that already appeared (OpenAI-style). Nudges toward new topics.',
    low: '0 · off.',
    high: '1–2 · pushes hard toward new words and subjects.',
  },
  frequencyPenalty: {
    body: 'Penalty that grows with how often a token already appeared. Curbs verbatim repetition.',
    low: '0 · off.',
    high: '1–2 · strongly suppresses repeated tokens.',
  },
  mirostat: {
    body: 'A feedback sampler that targets a constant "surprise" level instead of top-k/p. 0 = off, 1 = v1, 2 = v2.',
    low: '0 · use top-k / top-p / min-p instead.',
    high: '2 · auto-steers output perplexity toward Tau.',
  },
  mirostatTau: {
    body: 'Mirostat target entropy — the perplexity it steers toward (only used when Mirostat is on).',
    low: '3 · tighter, more focused.',
    high: '6+ · looser, more diverse.',
  },
  mirostatEta: {
    body: 'Mirostat learning rate — how quickly it corrects back toward Tau.',
    low: 'smooth, gradual adjustments.',
    high: 'fast, twitchy adjustments.',
  },
  dryMultiplier: {
    body: 'DRY ("Don\'t Repeat Yourself") penalizes repeating multi-token sequences — the best fix for phrase loops. 0 = off.',
    low: '0 · off.',
    high: '0.8+ · strongly breaks repeated phrasing.',
  },
  dryBase: {
    body: 'DRY base — how steeply the penalty grows as a repeated sequence gets longer.',
    low: 'gentler growth.',
    high: 'steeper growth.',
  },
  dryAllowedLength: {
    body: 'Longest repeated sequence DRY tolerates before it starts penalizing.',
    low: '2 · penalize even short repeats.',
    high: '4+ · only penalize longer repeats.',
  },
  seed: {
    body: 'Random seed. -1 = fresh randomness each run. Pin it to a fixed number to reproduce an exact output.',
    low: '-1 · random every time.',
    high: 'any fixed number · fully repeatable.',
  },
}

/** A labelled control with an optional click-to-open A/B tooltip card. */
function Control({ label, value, info, children }: { label: string; value?: string; info?: Tip; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="field">
      <div className="field-label">
        <span>
          {label}
          {value !== undefined ? (
            <>
              : <b>{value}</b>
            </>
          ) : null}
        </span>
        {info && (
          <button
            type="button"
            className={cx('infotip-btn', open && 'on')}
            aria-expanded={open}
            aria-label={`About ${label}`}
            onClick={() => setOpen((o) => !o)}
          >
            ⓘ
          </button>
        )}
      </div>
      {children}
      {info && open && (
        <div className="infotip-pop">
          <div className="infotip-body">{info.body}</div>
          {(info.low || info.high) && (
            <div className="infotip-ab">
              {info.low && (
                <div className="ab ab-low">
                  <b>Low / off</b>
                  <span>{info.low}</span>
                </div>
              )}
              {info.high && (
                <div className="ab ab-high">
                  <b>High</b>
                  <span>{info.high}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const [showModels, setShowModels] = useState(false)
  const loadedModel = useStore((s) => s.loadedModel)
  const confirm = useConfirm()

  const resetAdvanced = () =>
    updateSettings({
      topK: defaultSettings.topK,
      minP: defaultSettings.minP,
      typicalP: defaultSettings.typicalP,
      repeatPenalty: defaultSettings.repeatPenalty,
      repeatLastN: defaultSettings.repeatLastN,
      presencePenalty: defaultSettings.presencePenalty,
      frequencyPenalty: defaultSettings.frequencyPenalty,
      mirostat: defaultSettings.mirostat,
      mirostatTau: defaultSettings.mirostatTau,
      mirostatEta: defaultSettings.mirostatEta,
      dryMultiplier: defaultSettings.dryMultiplier,
      dryBase: defaultSettings.dryBase,
      dryAllowedLength: defaultSettings.dryAllowedLength,
      seed: defaultSettings.seed,
    })

  const exportBackup = () => download('aphelion-backup.json', exportData(), 'application/json')
  const importBackup = async (file?: File) => {
    if (!file) return
    const text = await file.text()
    try {
      JSON.parse(text)
    } catch {
      alert('That file is not a valid Aphelion backup.')
      return
    }
    if (
      await confirm({
        title: 'Restore backup?',
        message:
          'This replaces ALL current characters, chats, and settings with the backup, then reloads. Export your current data first if you want to keep it.',
        confirmLabel: 'Restore',
      })
    ) {
      try {
        localStorage.setItem(STORE_KEY, text)
        window.location.reload()
      } catch {
        alert('Could not restore — local storage may be full.')
      }
    }
  }

  return (
    <>
    <Modal
      title="Settings"
      onClose={onClose}
      wide
      footer={
        <div className="row gap full">
          <div className="grow" />
          <button className="btn" onClick={onClose}>
            Done
          </button>
        </div>
      }
    >
      <div className="form">
        <UpdateCheck />

        <div className="field">
          <span>Your data</span>
          <div className="row gap">
            <button className="btn sm ghost" onClick={exportBackup}>
              ⬇ Export backup
            </button>
            <label className="btn sm ghost">
              ⬆ Import…
              <input
                type="file"
                accept="application/json,.json"
                hidden
                onChange={(e) => importBackup(e.target.files?.[0])}
              />
            </label>
          </div>
          <em className="hint">
            Save a JSON backup of everything (characters, chats, settings), or restore one. Do this before local
            storage fills up.
          </em>
        </div>

        <label className="field">
          <span>Engine API URL (bundled llama.cpp server)</span>
          <input value={settings.baseUrl} onChange={(e) => updateSettings({ baseUrl: e.target.value })} />
        </label>

        <label className="field">
          <span>Main text model</span>
          <div className="row gap" style={{ alignItems: 'center' }}>
            <span className="model-name" style={{ flex: 1 }} title={loadedModel || settings.model}>
              {friendlyModelName(loadedModel || settings.model)}
            </span>
            <button className="btn sm ghost" onClick={() => setShowModels(true)}>
              🗂 Manage models
            </button>
          </div>
        </label>

        <label className="field">
          <span>Theme</span>
          <select value={settings.theme} onChange={(e) => updateSettings({ theme: e.target.value })}>
            <option value="penumbra">Penumbra · cyan</option>
            <option value="synthwave">Synthwave · pink</option>
            <option value="cyber">Cyber · neon</option>
            <option value="ember">Ember · amber</option>
            <option value="bloodmoon">Bloodmoon · red</option>
          </select>
        </label>

        <VisionSettings />

        <Control label="Smart actions (control net)" value={settings.intentRouter} info={TIP.intentRouter}>
          <select
            value={settings.intentRouter}
            onChange={(e) => updateSettings({ intentRouter: e.target.value as 'off' | 'quick' | 'full' })}
          >
            <option value="off">Off</option>
            <option value="quick">Quick — only task-like prompts</option>
            <option value="full">Full — classify every prompt</option>
          </select>
        </Control>

        <Control label="Temperature" value={settings.temperature.toFixed(2)} info={TIP.temperature}>
          <input
            type="range"
            min={0}
            max={2}
            step={0.05}
            value={settings.temperature}
            onChange={(e) => updateSettings({ temperature: Number(e.target.value) })}
          />
        </Control>

        <Control label="Top-p" value={settings.topP.toFixed(2)} info={TIP.topP}>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={settings.topP}
            onChange={(e) => updateSettings({ topP: Number(e.target.value) })}
          />
        </Control>

        <label className="field">
          <span>Max tokens (0 = unlimited)</span>
          <input
            type="number"
            min={0}
            value={settings.maxTokens}
            onChange={(e) => updateSettings({ maxTokens: Number(e.target.value) })}
          />
          <em className="hint">
            Keep this at 0. This is a reasoning model — a low cap gets eaten by the thinking phase, leaving an empty
            reply.
          </em>
        </label>

        <label className="field">
          <span>Context length</span>
          <input
            type="number"
            min={0}
            value={settings.contextLength}
            onChange={(e) => updateSettings({ contextLength: Number(e.target.value) })}
          />
          <em className="hint">Sent to the engine as num_ctx and used to trim the rolling context. Check VRAM before raising.</em>
        </label>

        <details className="sub">
          <summary>Advanced sampling</summary>
          <div className="sub-body">
            <em className="hint">
              These default to llama.cpp's own values, so they change nothing until you touch them. Click ⓘ on any
              control for what it does and how low vs high behaves.
            </em>

            <Control label="Top-k" value={String(settings.topK)} info={TIP.topK}>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={settings.topK}
                onChange={(e) => updateSettings({ topK: Math.trunc(Number(e.target.value)) })}
              />
            </Control>

            <Control label="Min-p" value={settings.minP.toFixed(2)} info={TIP.minP}>
              <input
                type="range"
                min={0}
                max={0.5}
                step={0.01}
                value={settings.minP}
                onChange={(e) => updateSettings({ minP: Number(e.target.value) })}
              />
            </Control>

            <Control label="Typical-p" value={settings.typicalP.toFixed(2)} info={TIP.typicalP}>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={settings.typicalP}
                onChange={(e) => updateSettings({ typicalP: Number(e.target.value) })}
              />
            </Control>

            <Control label="Repeat penalty" value={settings.repeatPenalty.toFixed(2)} info={TIP.repeatPenalty}>
              <input
                type="range"
                min={1}
                max={1.5}
                step={0.01}
                value={settings.repeatPenalty}
                onChange={(e) => updateSettings({ repeatPenalty: Number(e.target.value) })}
              />
            </Control>

            <Control label="Repeat window (last N)" value={String(settings.repeatLastN)} info={TIP.repeatLastN}>
              <input
                type="range"
                min={0}
                max={512}
                step={16}
                value={settings.repeatLastN}
                onChange={(e) => updateSettings({ repeatLastN: Math.trunc(Number(e.target.value)) })}
              />
            </Control>

            <Control label="Presence penalty" value={settings.presencePenalty.toFixed(2)} info={TIP.presencePenalty}>
              <input
                type="range"
                min={-2}
                max={2}
                step={0.05}
                value={settings.presencePenalty}
                onChange={(e) => updateSettings({ presencePenalty: Number(e.target.value) })}
              />
            </Control>

            <Control label="Frequency penalty" value={settings.frequencyPenalty.toFixed(2)} info={TIP.frequencyPenalty}>
              <input
                type="range"
                min={-2}
                max={2}
                step={0.05}
                value={settings.frequencyPenalty}
                onChange={(e) => updateSettings({ frequencyPenalty: Number(e.target.value) })}
              />
            </Control>

            <Control label="Mirostat" info={TIP.mirostat}>
              <select value={settings.mirostat} onChange={(e) => updateSettings({ mirostat: Number(e.target.value) })}>
                <option value={0}>Off</option>
                <option value={1}>v1</option>
                <option value={2}>v2</option>
              </select>
            </Control>

            {settings.mirostat > 0 && (
              <>
                <Control label="Mirostat τ (tau)" value={settings.mirostatTau.toFixed(1)} info={TIP.mirostatTau}>
                  <input
                    type="range"
                    min={0}
                    max={10}
                    step={0.1}
                    value={settings.mirostatTau}
                    onChange={(e) => updateSettings({ mirostatTau: Number(e.target.value) })}
                  />
                </Control>
                <Control label="Mirostat η (eta)" value={settings.mirostatEta.toFixed(2)} info={TIP.mirostatEta}>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={settings.mirostatEta}
                    onChange={(e) => updateSettings({ mirostatEta: Number(e.target.value) })}
                  />
                </Control>
              </>
            )}

            <Control label="DRY multiplier" value={settings.dryMultiplier.toFixed(2)} info={TIP.dryMultiplier}>
              <input
                type="range"
                min={0}
                max={4}
                step={0.05}
                value={settings.dryMultiplier}
                onChange={(e) => updateSettings({ dryMultiplier: Number(e.target.value) })}
              />
            </Control>

            {settings.dryMultiplier > 0 && (
              <>
                <Control label="DRY base" value={settings.dryBase.toFixed(2)} info={TIP.dryBase}>
                  <input
                    type="range"
                    min={1}
                    max={4}
                    step={0.05}
                    value={settings.dryBase}
                    onChange={(e) => updateSettings({ dryBase: Number(e.target.value) })}
                  />
                </Control>
                <Control label="DRY allowed length" value={String(settings.dryAllowedLength)} info={TIP.dryAllowedLength}>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    step={1}
                    value={settings.dryAllowedLength}
                    onChange={(e) => updateSettings({ dryAllowedLength: Math.trunc(Number(e.target.value)) })}
                  />
                </Control>
              </>
            )}

            <Control label="Seed (-1 = random)" info={TIP.seed}>
              <input
                type="number"
                value={settings.seed}
                onChange={(e) => updateSettings({ seed: e.target.value === '' ? -1 : Math.trunc(Number(e.target.value)) })}
              />
            </Control>

            <button className="btn sm ghost" onClick={resetAdvanced}>
              Reset advanced to defaults
            </button>
          </div>
        </details>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.autoExpandReasoning}
            onChange={(e) => updateSettings({ autoExpandReasoning: e.target.checked })}
          />
          <span>Auto-expand reasoning panels</span>
        </label>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.proofread}
            onChange={(e) => updateSettings({ proofread: e.target.checked })}
          />
          <span>Proofread replies (fix spelling &amp; grammar)</span>
        </label>
        <em className="hint">
          Re-runs each finished reply through the model to fix typos and grammar without changing the content. Roughly
          doubles generation time — off by default.
        </em>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.reduceMotion}
            onChange={(e) => updateSettings({ reduceMotion: e.target.checked })}
          />
          <span>Reduce motion</span>
        </label>
        <em className="hint">
          Minimizes animations and transitions. Applied automatically when your system's “reduce motion” setting is on.
        </em>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.highContrast}
            onChange={(e) => updateSettings({ highContrast: e.target.checked })}
          />
          <span>High contrast</span>
        </label>
        <em className="hint">Full-strength secondary text and stronger borders for better legibility.</em>
      </div>
    </Modal>
    {showModels && <ModelsModal onClose={() => setShowModels(false)} />}
    </>
  )
}
