import { useEffect, useRef, useState } from 'react'
import { useChatStore } from './stores/chat'
import type { BackendMode, Settings } from '../../shared/ipc-contracts'

const STATUS_LABEL: Record<string, string> = {
  idle: 'idle',
  starting: 'starting…',
  ready: 'ready',
  streaming: 'streaming…',
  disconnected: 'disconnected',
  error: 'error'
}

function SettingsPanel({ settings, onSaved }: { settings: Settings; onSaved: (s: Settings) => void }): React.JSX.Element {
  const [draft, setDraft] = useState<Settings>(settings)
  const [saved, setSaved] = useState(false)

  const update = (patch: Partial<Settings>): void => setDraft({ ...draft, ...patch })

  const save = async (): Promise<void> => {
    const next = await window.piwright.setSettings(draft)
    onSaved(next)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  return (
    <div className="settings">
      <label>
        Backend
        <select
          value={draft.backend}
          onChange={(e) => update({ backend: e.target.value as BackendMode })}
        >
          <option value="auto">auto</option>
          <option value="native">native</option>
          <option value="wsl">wsl</option>
        </select>
      </label>
      <label>
        WSL distro
        <input
          value={draft.wslDistro}
          placeholder="auto"
          onChange={(e) => update({ wslDistro: e.target.value })}
        />
      </label>
      <label>
        pi path
        <input value={draft.piPath} placeholder="auto" onChange={(e) => update({ piPath: e.target.value })} />
      </label>
      <label>
        Project dir
        <input
          value={draft.projectDir}
          placeholder="C:\Projects\…"
          onChange={(e) => update({ projectDir: e.target.value })}
        />
      </label>
      <button onClick={() => void save()}>Save</button>
      {saved && <span className="saved">saved — applies to the next session</span>}
    </div>
  )
}

export function App(): React.JSX.Element {
  const status = useChatStore((s) => s.status)
  const userMessages = useChatStore((s) => s.userMessages)
  const assistantText = useChatStore((s) => s.assistantText)
  const thinkingText = useChatStore((s) => s.thinkingText)
  const streaming = useChatStore((s) => s.streaming)
  const applyEvent = useChatStore((s) => s.applyEvent)
  const setStatus = useChatStore((s) => s.setStatus)
  const setSettings = useChatStore((s) => s.setSettings)
  const settings = useChatStore((s) => s.settings)
  const addUserMessage = useChatStore((s) => s.addUserMessage)
  const resetTranscript = useChatStore((s) => s.resetTranscript)
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const offEvent = window.piwright.onPiEvent((event) => applyEvent(event))
    const offStatus = window.piwright.onPiStatus((s) => setStatus(s))
    void window.piwright.getSettings().then(setSettings)
    return () => {
      offEvent()
      offStatus()
    }
  }, [applyEvent, setStatus, setSettings])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [assistantText, userMessages.length])

  const send = async (): Promise<void> => {
    const text = input.trim()
    if (text.length === 0) return
    setInput('')
    addUserMessage(text)
    const result = await window.piwright.prompt(text)
    if (!result.ok && result.error !== null) {
      setStatus({ ...status, state: 'error', error: result.error })
    }
  }

  return (
    <div className="app">
      <header className="header">
        <span className={`dot ${status.state}`} />
        <span className="state">{STATUS_LABEL[status.state] ?? status.state}</span>
        {status.backend !== null && <span className="backend">{status.backend}</span>}
        {status.model !== null && <span className="model">{status.model}</span>}
        <span className="spacer" />
        <button className="clear" onClick={resetTranscript}>
          clear
        </button>
      </header>
      {status.error !== null && <div className="error">{status.error}</div>}
      <main className="transcript">
        {userMessages.map((text, i) => (
          <div key={i} className="user-message">
            {text}
          </div>
        ))}
        {thinkingText.length > 0 && (
          <details className="thinking">
            <summary>thinking</summary>
            <pre>{thinkingText}</pre>
          </details>
        )}
        {assistantText.length > 0 && <div className="assistant-message">{assistantText}</div>}
        {streaming && <div className="cursor">▍</div>}
        <div ref={bottomRef} />
      </main>
      <footer className="composer">
        <textarea
          value={input}
          placeholder="Message pi…"
          rows={3}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <button onClick={() => void send()} disabled={input.trim().length === 0}>
          Send
        </button>
      </footer>
      {settings !== null && <SettingsPanel settings={settings} onSaved={setSettings} />}
    </div>
  )
}
