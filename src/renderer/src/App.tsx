import { useEffect, useRef, useState } from 'react'
import { DialogCard } from './components/DialogCard'
import { Markdown } from './components/Markdown'
import { ToolBlock } from './components/ToolBlock'
import { useChatStore } from './stores/chat'
import type { Entry } from './stores/chat'
import type { BackendMode, Settings } from '../../shared/ipc-contracts'
import type { DialogAnswer } from '../../shared/agent-events'

const STATUS_LABEL: Record<string, string> = {
  idle: 'idle',
  starting: 'starting…',
  ready: 'ready',
  streaming: 'streaming…',
  disconnected: 'disconnected',
  error: 'error'
}

function EntryView({ entry, onAnswer }: { entry: Entry; onAnswer: (dialogId: string, answer: DialogAnswer) => void }): React.JSX.Element | null {
  switch (entry.kind) {
    case 'user':
      return <div className="user-message">{entry.text}</div>
    case 'text':
      return <div className="assistant-message"><Markdown text={entry.text} /></div>
    case 'thinking':
      return (
        <details className="thinking">
          <summary>thinking</summary>
          <pre>{entry.text}</pre>
        </details>
      )
    case 'tool':
      return <ToolBlock call={entry.call} partial={entry.partial} result={entry.result} />
    case 'dialog':
      return <DialogCard dialog={entry.dialog} receipt={entry.receipt} onAnswer={(answer) => onAnswer(entry.dialogId, answer)} />
    case 'info':
      return <div className="info-message">{entry.text}</div>
    case 'error':
      return <div className="error entry-error">{entry.text}</div>
    case 'result': {
      const u = entry.usage
      const speed = u.speed
      const ttfb =
        speed !== null && speed.ttfbMs < 1000 ? `${Math.round(speed.ttfbMs)}ms` : speed !== null ? `${(speed.ttfbMs / 1000).toFixed(1)}s` : null
      const parts = [
        `in ${u.inputTokens.toLocaleString('en-US')}`,
        `out ${u.outputTokens.toLocaleString('en-US')}`,
        u.contextTokens !== null ? `ctx ${u.contextTokens.toLocaleString('en-US')}` : null,
        ttfb !== null ? `TTFB ${ttfb}` : null,
        speed?.tokensPerSecond != null ? `${Math.round(speed.tokensPerSecond)} tok/s` : null
      ].filter((p): p is string => p !== null)
      return <div className="turn-result">{parts.join(' · ')}</div>
    }
  }
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
  const entries = useChatStore((s) => s.entries)
  const streaming = useChatStore((s) => s.streaming)
  const queue = useChatStore((s) => s.queue)
  const contextUsage = useChatStore((s) => s.contextUsage)
  const applyEvent = useChatStore((s) => s.applyEvent)
  const setStatus = useChatStore((s) => s.setStatus)
  const setSettings = useChatStore((s) => s.setSettings)
  const settings = useChatStore((s) => s.settings)
  const addUserMessage = useChatStore((s) => s.addUserMessage)
  const setDialogReceipt = useChatStore((s) => s.setDialogReceipt)
  const resetTranscript = useChatStore((s) => s.resetTranscript)
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const offEvent = window.piwright.onPiEvent((event) => applyEvent(event))
    const offStatus = window.piwright.onPiStatus((s) => setStatus(s))
    void window.piwright.getSettings().then(setSettings)
    void window.piwright.getPendingDialogs().then((pending) => {
      for (const p of pending) applyEvent({ type: 'dialog_open', id: p.id, dialog: p.dialog })
    })
    return () => {
      offEvent()
      offStatus()
    }
  }, [applyEvent, setStatus, setSettings])

  const lastEntry = entries[entries.length - 1]
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [entries.length, lastEntry])

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

  const abort = async (): Promise<void> => {
    const result = await window.piwright.abort()
    if (!result.ok && result.error !== null && result.error !== 'pi connection is not running') {
      setStatus({ ...status, state: 'error', error: result.error })
    }
  }

  const answerDialog = async (dialogId: string, answer: DialogAnswer): Promise<void> => {
    setDialogReceipt(dialogId, answer.kind === 'cancelled' ? 'cancelled' : 'answered')
    const result = await window.piwright.respondDialog(dialogId, answer)
    if (!result.ok) {
      setDialogReceipt(dialogId, 'expired')
    }
  }

  const queuedCount = queue.steering.length + queue.followUp.length
  const modelKey = status.model

  return (
    <div className="app">
      <header className="header">
        <span className={`dot ${status.state}`} />
        <span className="state">{STATUS_LABEL[status.state] ?? status.state}</span>
        {status.backend !== null && <span className="backend">{status.backend}</span>}
        {status.models.length > 0 && (
          <select
            className="model-select"
            value={modelKey ?? ''}
            onChange={(e) => void window.piwright.setModel(e.target.value)}
          >
            {modelKey !== null && !status.models.some((m) => `${m.provider}/${m.id}` === modelKey) && (
              <option value={modelKey}>{modelKey}</option>
            )}
            {status.models.map((m) => (
              <option key={`${m.provider}/${m.id}`} value={`${m.provider}/${m.id}`}>
                {m.name}
              </option>
            ))}
          </select>
        )}
        {modelKey === null && status.model !== null && <span className="model">{status.model}</span>}
        {status.thinkingLevels.length > 0 && (
          <select
            className="thinking-select"
            value={status.thinkingLevel ?? ''}
            onChange={(e) => void window.piwright.setThinkingLevel(e.target.value)}
          >
            {status.thinkingLevels.map((level) => (
              <option key={level} value={level}>
                thinking: {level}
              </option>
            ))}
          </select>
        )}
        {contextUsage !== null && contextUsage.size > 0 && (
          <span className="ctx-usage">{Math.round((contextUsage.used / contextUsage.size) * 100)}%</span>
        )}
        {queuedCount > 0 && <span className="queue-label">Queued: {queuedCount}</span>}
        <span className="spacer" />
        <button className="abort" onClick={() => void abort()} disabled={!streaming}>
          Stop
        </button>
        <button className="clear" onClick={resetTranscript}>
          clear
        </button>
      </header>
      {status.error !== null && <div className="error">{status.error}</div>}
      <main className="transcript">
        {entries.map((entry) => (
          <EntryView key={entry.id} entry={entry} onAnswer={(id, answer) => void answerDialog(id, answer)} />
        ))}
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
