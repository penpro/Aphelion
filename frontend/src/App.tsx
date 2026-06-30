import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useStore } from './store'
import { Sidebar } from './components/Sidebar'
import { ChatView } from './components/ChatView'
import { StoryView } from './components/StoryView'
import { TreeView } from './components/TreeView'
import { AskView } from './components/AskView'
import { CharacterEditor } from './components/CharacterEditor'
import { PersonaEditor } from './components/PersonaEditor'
import { SettingsPanel } from './components/SettingsPanel'
import { SetupWizard } from './components/SetupWizard'
import { Tutorial } from './components/Tutorial'
import { TitleBar } from './components/TitleBar'
import { ResizeHandles } from './components/ResizeHandles'
import type { Character } from './types'

export default function App() {
  const view = useStore((s) => s.view)
  const theme = useStore((s) => s.settings.theme)
  const reduceMotion = useStore((s) => s.settings.reduceMotion)
  const highContrast = useStore((s) => s.settings.highContrast)
  const [editingChar, setEditingChar] = useState<Character | 'new' | null>(null)
  const [showPersona, setShowPersona] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [showTutorial, setShowTutorial] = useState(false)
  const updateSettings = useStore((s) => s.updateSettings)

  // First run: if no model has been downloaded yet, show the setup wizard.
  // Once a model exists and the tutorial hasn't been seen, open it once.
  useEffect(() => {
    invoke<string[]>('list_models')
      .then((models) => {
        setNeedsSetup(models.length === 0)
        if (models.length > 0 && !useStore.getState().settings.seenTutorial) setShowTutorial(true)
      })
      .catch(() => setNeedsSetup(false)) // not running under Tauri (browser dev) — skip
  }, [])

  useEffect(() => {
    const r = document.documentElement
    r.setAttribute('data-theme', theme)
    r.setAttribute('data-reduce-motion', String(reduceMotion))
    r.setAttribute('data-contrast', highContrast ? 'high' : 'normal')
  }, [theme, reduceMotion, highContrast])

  return (
    <>
      <TitleBar />
      <div className="app">
      <a className="skip-link" href="#main-view">
        Skip to content
      </a>
      <Sidebar
        onEditCharacter={(c) => setEditingChar(c)}
        onNewCharacter={() => setEditingChar('new')}
        onOpenPersona={() => setShowPersona(true)}
        onOpenSettings={() => setShowSettings(true)}
        onOpenTutorial={() => setShowTutorial(true)}
      />

      <main id="main-view" className="view-region">
        {view === 'chat' && <ChatView onEditCharacter={(c) => setEditingChar(c)} />}
        {view === 'story' && <StoryView />}
        {view === 'tree' && <TreeView />}
        {view === 'ask' && <AskView />}
      </main>

      {editingChar && <CharacterEditor editing={editingChar} onClose={() => setEditingChar(null)} />}
      {showPersona && <PersonaEditor onClose={() => setShowPersona(false)} />}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {showTutorial && (
        <Tutorial
          onClose={() => {
            setShowTutorial(false)
            updateSettings({ seenTutorial: true })
          }}
        />
      )}

      {needsSetup && <SetupWizard onReady={() => setNeedsSetup(false)} />}
      </div>
      <ResizeHandles />
    </>
  )
}
