import { useState } from 'react'
import { Modal } from './Modal'
import { useStore } from '../store'

export function PersonaEditor({ onClose }: { onClose: () => void }) {
  const persona = useStore((s) => s.persona)
  const setPersona = useStore((s) => s.setPersona)
  const [name, setName] = useState(persona.name)
  const [description, setDescription] = useState(persona.description)

  const save = () => {
    setPersona({ name: name.trim() || 'You', description })
    onClose()
  }

  return (
    <Modal
      title="Your persona"
      onClose={onClose}
      footer={
        <div className="row gap full">
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
        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>
            About you <em className="hint">— this is what the model knows as {'{{user}}'}</em>
          </span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={6} />
        </label>
      </div>
    </Modal>
  )
}
