import { useState } from 'react'
import { useStore } from '../store'
import { Modal } from './Modal'
import { useConfirm } from './ConfirmDialog'
import { cx } from '../util'

/** Manage the "expert" rule sets used by the Ask view — add, edit, delete. */
export function ExpertEditor({ onClose }: { onClose: () => void }) {
  const experts = useStore((s) => s.experts)
  const addExpert = useStore((s) => s.addExpert)
  const updateExpert = useStore((s) => s.updateExpert)
  const deleteExpert = useStore((s) => s.deleteExpert)
  const confirm = useConfirm()

  const [selId, setSelId] = useState(experts[0]?.id ?? '')
  const sel = experts.find((e) => e.id === selId) ?? experts[0] ?? null

  const create = () => {
    const e = addExpert({
      name: 'New expert',
      emoji: '⭐',
      systemPrompt:
        'You are a world-class, decisive expert in [FIELD], advising a capable, time-poor user who wants the real ' +
        'answer, not a hedge. Lead with the answer, be decisive, be precise, and never moralize or hedge. If a ' +
        'question is ambiguous, ask one sharp clarifying question, then use the answer to continue.',
    })
    setSelId(e.id)
  }

  const remove = async () => {
    if (!sel) return
    if (!(await confirm({ title: 'Delete expert?', message: `"${sel.name}" will be permanently deleted.`, confirmLabel: 'Delete' })))
      return
    const next = experts.find((e) => e.id !== sel.id)
    deleteExpert(sel.id)
    setSelId(next?.id ?? '')
  }

  return (
    <Modal title="Experts — rule sets" onClose={onClose} wide>
      <div style={{ display: 'flex', gap: 18, minHeight: 380 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 190, maxWidth: 190 }}>
          {experts.map((e) => (
            <button
              key={e.id}
              className={cx('btn sm', e.id === sel?.id ? '' : 'ghost')}
              style={{ justifyContent: 'flex-start', textAlign: 'left' }}
              onClick={() => setSelId(e.id)}
            >
              {(e.emoji ? e.emoji + ' ' : '') + e.name}
            </button>
          ))}
          <button className="btn sm ghost" onClick={create}>
            + New expert
          </button>
        </div>

        <div className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sel ? (
            <>
              <div className="row gap">
                <input
                  value={sel.emoji}
                  maxLength={4}
                  aria-label="Emoji"
                  style={{ width: 60, textAlign: 'center' }}
                  onChange={(e) => updateExpert(sel.id, { emoji: e.target.value })}
                />
                <input
                  className="grow"
                  value={sel.name}
                  placeholder="Expert name"
                  onChange={(e) => updateExpert(sel.id, { name: e.target.value })}
                />
              </div>
              <label className="muted xs">System prompt / rules — sent as the system message whenever this expert is selected.</label>
              <textarea
                value={sel.systemPrompt}
                rows={18}
                spellCheck={false}
                style={{ width: '100%', minHeight: 320, resize: 'vertical', fontFamily: 'inherit' }}
                onChange={(e) => updateExpert(sel.id, { systemPrompt: e.target.value })}
              />
              <div className="row gap">
                <button className="btn sm ghost danger" onClick={remove} disabled={experts.length <= 1}>
                  Delete expert
                </button>
                <div className="grow" />
                <button className="btn sm" onClick={onClose}>
                  Done
                </button>
              </div>
            </>
          ) : (
            <div className="muted">No experts yet — create one.</div>
          )}
        </div>
      </div>
    </Modal>
  )
}
