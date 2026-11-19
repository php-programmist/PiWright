import { useEffect } from 'react'
import { SessionsPanel } from './components/SessionsPanel'
import { ChatView } from './views/chat/ChatView'
import { SettingsView } from './views/settings/SettingsView'
import { useChatStore } from './stores/chat'
import { useSessionsStore } from './stores/sessions'

export function App(): React.JSX.Element {
  const applyEvent = useChatStore((s) => s.applyEvent)
  const applyChatStatus = useChatStore((s) => s.applyStatus)
  const applySessionsStatus = useSessionsStore((s) => s.applyStatus)
  const load = useSessionsStore((s) => s.load)
  const activeHostId = useSessionsStore((s) => s.activeHostId)
  const settingsOpen = useSessionsStore((s) => s.settingsOpen)
  const chat = useChatStore((s) => (activeHostId !== null ? s.hosts[activeHostId] : undefined))

  useEffect(() => {
    const offEvent = window.piwright.onPiEvent((message) => applyEvent(message))
    const offStatus = window.piwright.onPiStatus((status) => {
      applyChatStatus(status)
      applySessionsStatus(status)
    })
    void load()
    void window.piwright.getPendingDialogs().then((pending) => {
      for (const p of pending) applyEvent({ hostId: p.hostId, event: { type: 'dialog_open', id: p.id, dialog: p.dialog } })
    })
    return () => {
      offEvent()
      offStatus()
    }
  }, [applyEvent, applyChatStatus, applySessionsStatus, load])

  return (
    <div className="app">
      {settingsOpen ? (
        <SettingsView />
      ) : (
        <div className="layout">
          <SessionsPanel />
          <div className="chat-column">
            <ChatView chat={chat ?? null} />
          </div>
        </div>
      )}
    </div>
  )
}
