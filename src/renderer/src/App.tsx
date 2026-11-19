import { useEffect } from 'react'
import { SessionsPanel } from './components/SessionsPanel'
import { GitPanel } from './views/git/GitPanel'
import { DiffOverlay } from './views/git/DiffOverlay'
import { ChatView } from './views/chat/ChatView'
import { SettingsView } from './views/settings/SettingsView'
import { useChatStore } from './stores/chat'
import { useGitStore } from './stores/git'
import { useSessionsStore } from './stores/sessions'

export function App(): React.JSX.Element {
  const applyEvent = useChatStore((s) => s.applyEvent)
  const applyChatStatus = useChatStore((s) => s.applyStatus)
  const applySessionsStatus = useSessionsStore((s) => s.applyStatus)
  const load = useSessionsStore((s) => s.load)
  const activeHostId = useSessionsStore((s) => s.activeHostId)
  const settingsOpen = useSessionsStore((s) => s.settingsOpen)
  const gitOpen = useGitStore((s) => s.open)
  const toggleGit = useGitStore((s) => s.toggleOpen)
  const diffOpen = useGitStore((s) => s.selectedPath !== null)
  const chat = useChatStore((s) => (activeHostId !== null ? s.hosts[activeHostId] : undefined))

  useEffect(() => {
    const offEvent = window.piwright.onPiEvent((message) => {
      applyEvent(message)
      if (message.event.type !== 'turn_end') return
      const row = useSessionsStore.getState().active.find((r) => r.hostId === message.hostId)
      if (row !== undefined) void useGitStore.getState().refreshStatus(row.project, true)
    })
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
            {diffOpen && <DiffOverlay />}
          </div>
          <div className="right-side">
            {gitOpen && <GitPanel />}
            <div className="right-bar">
              <button className={gitOpen ? 'active' : ''} title="Git" onClick={toggleGit}>
                <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
                  <line x1="1" y1="8" x2="15" y2="8" stroke="currentColor" strokeWidth="1.4" />
                  <circle cx="8" cy="8" r="3.2" fill="#171a1f" stroke="currentColor" strokeWidth="1.4" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
