import { useEffect, useRef } from 'react'
import { SessionsPanel } from './components/SessionsPanel'
import { GitPanel } from './views/git/GitPanel'
import { DiffOverlay } from './views/git/DiffOverlay'
import { FilesPanel } from './views/files/FilesPanel'
import { FileViewer } from './views/files/FileViewer'
import { TerminalPanel } from './views/terminal/TerminalPanel'
import { termWrite, termWriteExit } from './views/terminal/term-registry'
import { ChatView } from './views/chat/ChatView'
import { SettingsView } from './views/settings/SettingsView'
import { useChatStore } from './stores/chat'
import { useFilesStore } from './stores/files'
import { useGitStore } from './stores/git'
import { useSessionsStore } from './stores/sessions'
import { useTerminalStore } from './stores/terminal'
import { hydratePanels, persistPanel } from './stores/panels-prefs'

export function App(): React.JSX.Element {
  const applyEvent = useChatStore((s) => s.applyEvent)
  const applyChatStatus = useChatStore((s) => s.applyStatus)
  const applySessionsStatus = useSessionsStore((s) => s.applyStatus)
  const load = useSessionsStore((s) => s.load)
  const activeHostId = useSessionsStore((s) => s.activeHostId)
  const settingsOpen = useSessionsStore((s) => s.settingsOpen)
  const gitOpen = useGitStore((s) => s.open)
  const diffOpen = useGitStore((s) => s.selectedPath !== null)
  const filesOpen = useFilesStore((s) => s.open)
  const viewerOpen = useFilesStore((s) => s.viewerOpen)
  const termOpen = useTerminalStore((s) => s.open)
  const settings = useSessionsStore((s) => s.settings)
  const hydratedRef = useRef(false)

  useEffect(() => {
    if (settings === null || hydratedRef.current) return
    hydratedRef.current = true
    hydratePanels(settings)
  }, [settings])

  const toggleGit = (): void => {
    useGitStore.getState().toggleOpen()
    persistPanel('git', { open: useGitStore.getState().open })
  }
  const toggleFiles = (): void => {
    useFilesStore.getState().toggleOpen()
    persistPanel('files', { open: useFilesStore.getState().open })
  }
  const toggleTerm = (): void => {
    useTerminalStore.getState().toggleOpen()
    persistPanel('terminal', { open: useTerminalStore.getState().open })
  }
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
    const offFilesChanged = window.piwright.onFilesChanged((message) => {
      void useFilesStore.getState().applyFileChanged(message.project, message.path)
    })
    const offTermData = window.piwright.onTermData((message) => termWrite(message.id, message.data))
    const offTermExit = window.piwright.onTermExit((message) => {
      termWriteExit(message.id, message.code)
      useTerminalStore.getState().applyExit(message.id, message.code)
    })
    void load()
    void window.piwright.getPendingDialogs().then((pending) => {
      for (const p of pending) applyEvent({ hostId: p.hostId, event: { type: 'dialog_open', id: p.id, dialog: p.dialog } })
    })
    return () => {
      offEvent()
      offStatus()
      offFilesChanged()
      offTermData()
      offTermExit()
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
            {viewerOpen && <FileViewer />}
          </div>
          <div className="right-side">
            {gitOpen && <GitPanel />}
            {filesOpen && <FilesPanel />}
            {termOpen && <TerminalPanel />}
            <div className="right-bar">
              <button className={gitOpen ? 'active' : ''} title="Git" onClick={toggleGit}>
                <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
                  <line x1="1" y1="8" x2="15" y2="8" stroke="currentColor" strokeWidth="1.4" />
                  <circle cx="8" cy="8" r="3.2" fill="#171a1f" stroke="currentColor" strokeWidth="1.4" />
                </svg>
              </button>
              <button className={filesOpen ? 'active' : ''} title="Files" onClick={toggleFiles}>
                <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M1.5 3.5h4.6l1.4 1.8h7v7.2h-13z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <button className={termOpen ? 'active' : ''} title="Terminal" onClick={toggleTerm}>
                <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
                  <path
                    d="M4 6l3 2.5L4 11"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <line x1="8.5" y1="11" x2="12" y2="11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
