import { useState } from 'react'
import { ChatWidget } from './components/chat/ChatWidget.jsx'
import { HomePage } from './components/home/HomePage.jsx'
import { SettingsDialog } from './components/settings/SettingsDialog.jsx'
import { useHealth } from './hooks/useHealth.js'
import { useTheme } from './hooks/useTheme.js'
import './home.css'
import './responses.css'

export default function App() {
  const theme = useTheme()
  const { health, recheck } = useHealth()
  const [settingsOpen, setSettingsOpen] = useState(false)

  return (
    <>
      <HomePage />
      <ChatWidget health={health} theme={theme} onOpenSettings={() => setSettingsOpen(true)} />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={theme}
        health={health}
        onRecheck={recheck}
      />
    </>
  )
}
