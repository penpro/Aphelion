import { useState } from 'react'
import { useStore } from './store'
import { Sidebar } from './components/Sidebar'
import { ChatView } from './components/ChatView'
import { StoryView } from './components/StoryView'
import { TreeView } from './components/TreeView'
import { AskView } from './components/AskView'
import { CharacterEditor } from './components/CharacterEditor'
import { PersonaEditor } from './components/PersonaEditor'
import { SettingsPanel } from './components/SettingsPanel'
import type { Character } from './types'

export default function App() {
  const view = useStore((s) => s.view)
  const [editingChar, setEditingChar] = useState<Character | 'new' | null>(null)
  const [showPersona, setShowPersona] = useState(false)
  const [showSettings, setShowSettings] = useState(false)

  return (
    <div className="app">
      <Sidebar
        onEditCharacter={(c) => setEditingChar(c)}
        onNewCharacter={() => setEditingChar('new')}
        onOpenPersona={() => setShowPersona(true)}
        onOpenSettings={() => setShowSettings(true)}
      />

      {view === 'chat' && <ChatView onEditCharacter={(c) => setEditingChar(c)} />}
      {view === 'story' && <StoryView />}
      {view === 'tree' && <TreeView />}
      {view === 'ask' && <AskView />}

      {editingChar && <CharacterEditor editing={editingChar} onClose={() => setEditingChar(null)} />}
      {showPersona && <PersonaEditor onClose={() => setShowPersona(false)} />}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </div>
  )
}
