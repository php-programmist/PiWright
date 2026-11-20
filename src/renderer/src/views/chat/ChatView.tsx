import { useEffect, useMemo, useRef, useState } from 'react'
import { DialogCard } from '../../components/DialogCard'
import { Markdown } from '../../components/Markdown'
import { TodoPanel } from '../../components/TodoPanel'
import { ToolBlock } from '../../components/ToolBlock'
import { useChatStore, atBottomMap } from '../../stores/chat'
import type { Entry, HostChat } from '../../stores/chat'
import { useSessionsStore } from '../../stores/sessions'
import { cacheHitOf, percentColor } from '../../../../shared/agent-events'
import { base64FromBytes } from '../../../../shared/attachments'
import { PLAN_WIDGET_KEY, TODO_WIDGET_KEY, parseTodoLines } from '../../../../shared/todo'
import { useT } from '../../lib/i18n'
import { splitWorktreeHostDir } from '../../../../shared/worktree'
import type { DialogAnswer } from '../../../../shared/agent-events'

const STATUS_LABEL: Record<string, string> = {
  idle: 'idle',
  starting: 'starting…',
  ready: 'ready',
  streaming: 'streaming…',
  disconnected: 'disconnected',
  error: 'error'
}

export function EntryView({ entry, onAnswer }: { entry: Entry; onAnswer: (dialogId: string, answer: DialogAnswer) => void }): React.JSX.Element | null {
  switch (entry.kind) {
    case 'user':
      return <div className="user-message">{entry.text}</div>
    case 'text':
      return <div className="assistant-message"><Markdown text={entry.text} /></div>
    case 'thinking':
      return (
        <details className="thinking">
          <ChatThinkingSummary />
          <pre>{entry.text}</pre>
        </details>
      )
    case 'tool':
      return <ToolBlock call={entry.call} partial={entry.partial} result={entry.result} subTools={entry.children} />
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

export function ChatThinkingSummary(): React.JSX.Element {
  const t = useT()
  return <summary>{t('thinking')}</summary>
}

export function ChatView({ chat }: { chat: HostChat | null }): React.JSX.Element {
  const activeHostId = useSessionsStore((s) => s.activeHostId)
  const placement = useSessionsStore((s) => s.settings?.selectorPlacement ?? 'top')
  const sendOnEnter = useSessionsStore((s) => s.settings?.sendOnEnter ?? false)
  const t = useT()
  const status = chat?.status ?? null
  const entries = useMemo(() => chat?.entries ?? [], [chat])
  const streaming = chat?.streaming ?? false
  const queue = chat?.queue ?? { steering: [], followUp: [] }
  const contextUsage = chat?.contextUsage ?? null
  const usageTotals = chat?.usageTotals ?? null
  const extensionStatuses = chat?.extensionStatuses ?? {}
  const widgets = chat?.widgets ?? {}
  const todoItems = parseTodoLines(widgets[TODO_WIDGET_KEY] ?? widgets[PLAN_WIDGET_KEY] ?? [])
  const applyEvent = useChatStore((s) => s.applyEvent)
  const addUserMessage = useChatStore((s) => s.addUserMessage)
  const setDialogReceipt = useChatStore((s) => s.setDialogReceipt)
  const toggleToolsHidden = useChatStore((s) => s.toggleToolsHidden)
  const toggleMuted = useChatStore((s) => s.toggleMuted)
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const transcriptRef = useRef<HTMLElement | null>(null)
  const autoScrollRef = useRef(true)
  const pendingImagesRef = useRef<string[]>([])
  const project = useSessionsStore((s) => s.active.find((r) => r.hostId === activeHostId)?.project ?? null)
  const worktree = project !== null ? splitWorktreeHostDir(project.dir) : null

  const activeHostRef = useRef(activeHostId ?? '')
  useEffect(() => {
    activeHostRef.current = activeHostId ?? ''
  }, [activeHostId])
  useEffect(() => () => {
    atBottomMap.delete(activeHostRef.current)
  }, [])

  useEffect(() => {
    autoScrollRef.current = true
    pendingImagesRef.current = []
  }, [activeHostId])

  useEffect(() => {
    if (!autoScrollRef.current || activeHostId === null) return
    atBottomMap.set(activeHostId, true)
    useChatStore.getState().markRead(activeHostId)
    bottomRef.current?.scrollIntoView({ behavior: streaming ? 'auto' : 'smooth' })
  }, [entries, streaming, activeHostId])

  const handleScroll = (): void => {
    const el = transcriptRef.current
    if (el === null || activeHostId === null) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 40
    autoScrollRef.current = atBottom
    atBottomMap.set(activeHostId, atBottom)
    if (atBottom) useChatStore.getState().markRead(activeHostId)
  }

  if (activeHostId === null || status === null) {
    return (
      <main className="chat-empty">
        <div className="panel-hint">{t('Create or pick a session on the left')}</div>
      </main>
    )
  }

  const send = async (): Promise<void> => {
    const text = input.trim()
    if (text.length === 0) return
    setInput('')
    addUserMessage(activeHostId, text)
    const images = pendingImagesRef.current
    pendingImagesRef.current = []
    const result = await window.piwright.prompt(activeHostId, text, images)
    if (!result.ok && result.error !== null) {
      applyEvent({ hostId: activeHostId, event: { type: 'turn_error', message: result.error } })
    }
  }

  const insertAttachmentRef = (ref: string): void => {
    setInput((v) => `${v}${v.length > 0 && !v.endsWith(' ') ? ' ' : ''}${ref} `)
  }

  const attachFile = async (): Promise<void> => {
    if (project === null) return
    const res = await window.piwright.chooseAttachment(project)
    if (!res.ok) return
    if (res.isImage) pendingImagesRef.current.push(res.name)
    insertAttachmentRef(res.ref)
  }

  const pasteImage = async (file: File): Promise<void> => {
    if (project === null) return
    const bytes = new Uint8Array(await file.arrayBuffer())
    const res = await window.piwright.putAttachment(project, file.name.length > 0 ? file.name : 'pasted.png', base64FromBytes(bytes))
    if (!res.ok) return
    pendingImagesRef.current.push(res.name)
    insertAttachmentRef(res.ref)
  }

  const abort = async (): Promise<void> => {
    const result = await window.piwright.abort(activeHostId)
    if (!result.ok && result.error !== null && result.error !== 'pi connection is not running') {
      applyEvent({ hostId: activeHostId, event: { type: 'turn_error', message: result.error } })
    }
  }

  const removeWorktree = async (): Promise<void> => {
    if (worktree === null || project === null) return
    if (!window.confirm(t("Remove worktree '{name}'?", { name: worktree.name }))) return
    let result = await window.piwright.worktreeRemove(project, worktree.name, false)
    if (!result.ok && result.uncommitted && window.confirm(t('There are uncommitted changes. Force remove?'))) {
      result = await window.piwright.worktreeRemove(project, worktree.name, true)
    }
    if (!result.ok) {
      window.alert(result.error)
      return
    }
    await window.piwright.closeSession(activeHostId)
    useChatStore.getState().removeHost(activeHostId)
    useSessionsStore.getState().forgetHost(activeHostId)
  }

  const answerDialog = async (dialogId: string, answer: DialogAnswer): Promise<void> => {
    setDialogReceipt(activeHostId, dialogId, answer.kind === 'cancelled' ? 'cancelled' : 'answered')
    const result = await window.piwright.respondDialog(activeHostId, dialogId, answer)
    if (!result.ok) {
      setDialogReceipt(activeHostId, dialogId, 'expired')
    }
  }

  const queuedCount = queue.steering.length + queue.followUp.length
  const modelKey = status.model
  const toolsHidden = chat?.toolsHidden ?? false
  const muted = chat?.muted ?? false
  const visibleEntries = toolsHidden ? entries.filter((e) => e.kind !== 'tool') : entries
  const ctxPercent =
    contextUsage !== null && contextUsage.size > 0 ? Math.min(100, Math.max(0, Math.round((contextUsage.used / contextUsage.size) * 100))) : null
  const fmtTokens = (n: number): string => n.toLocaleString('en-US')
  const ctxTitle = (): string => {
    if (usageTotals === null) return ''
    const parts = [t('In: {in} · Out: {out}', { in: fmtTokens(usageTotals.input), out: fmtTokens(usageTotals.output) })]
    const hit = cacheHitOf(usageTotals.input, usageTotals.cacheRead, usageTotals.cacheWrite)
    if (hit !== null) {
      parts.push(t('Read from cache: {read} ({hit}%)', { read: fmtTokens(usageTotals.cacheRead), hit }))
      parts.push(
        t('Fresh: {in} · Written to cache: {write}', { in: fmtTokens(usageTotals.input), write: fmtTokens(usageTotals.cacheWrite) })
      )
    }
    return parts.join('\n')
  }

  const controls = (
    <>
      {status.models.length > 0 && (
        <select
          className="model-select"
          value={modelKey ?? ''}
          onChange={(e) => void window.piwright.setModel(activeHostId, e.target.value)}
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
          onChange={(e) => void window.piwright.setThinkingLevel(activeHostId, e.target.value)}
        >
          {status.thinkingLevels.map((level) => (
            <option key={level} value={level}>
              {t('thinking: {level}', { level })}
            </option>
          ))}
        </select>
      )}
      <button className="abort" onClick={() => void abort()} disabled={!streaming}>
        {t('Stop')}
      </button>
    </>
  )

  return (
    <>
      <header className="header">
        <span className={`dot ${status.state}`} />
        <span className="state">{t(STATUS_LABEL[status.state] ?? status.state)}</span>
        {placement === 'top' && controls}
        {ctxPercent !== null && (
          <span className="ctx-usage" style={{ color: percentColor(ctxPercent) }} title={ctxTitle()}>
            {ctxPercent}%
          </span>
        )}
        {queuedCount > 0 && <span className="queue-label">{t('Queued: {count}', { count: queuedCount })}</span>}
        {Object.entries(extensionStatuses).map(([key, text]) => (
          <span key={key} className="ext-status" title={key}>
            {text}
          </span>
        ))}
        {worktree !== null && (
          <button className="icon" title={t('Remove worktree')} onClick={() => void removeWorktree()}>
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="6" cy="6" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <circle cx="6" cy="18" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <circle cx="18" cy="12" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="M6 8.4v7.2M8.4 6h4.1a3 3 0 0 1 3 3v.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </button>
        )}
        <button
          className="icon"
          title={muted ? t('Unmute sounds for this session') : t('Mute sounds for this session')}
          onClick={() => toggleMuted(activeHostId)}
        >
          {muted ? (
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M11 5L6 9H2v6h4l5 4V5z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <line x1="16" y1="9" x2="22" y2="15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              <line x1="22" y1="9" x2="16" y2="15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M11 5L6 9H2v6h4l5 4V5z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <path
                d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          )}
        </button>
        <button
          className="icon"
          title={toolsHidden ? t('Show tool blocks') : t('Hide tool blocks')}
          onClick={() => toggleToolsHidden(activeHostId)}
        >
          {toolsHidden ? (
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <line x1="1" y1="1" x2="23" y2="23" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
              <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          )}
        </button>
        <span className="spacer" />
      </header>
      {status.error !== null && <div className="error">{status.error}</div>}
      {todoItems.length > 0 && <TodoPanel items={todoItems} />}
      <main className="transcript" ref={transcriptRef} onScroll={handleScroll}>
        {visibleEntries.map((entry) => (
          <EntryView key={entry.id} entry={entry} onAnswer={(id, answer) => void answerDialog(id, answer)} />
        ))}
        {streaming && <div className="cursor">▍</div>}
        <div ref={bottomRef} />
      </main>
      {placement === 'bottom' && <div className="selector-bar">{controls}</div>}
      <footer className="composer">
        <textarea
          value={input}
          placeholder={
            sendOnEnter
              ? t('Ask Pi (Enter to send, Shift+Enter for newline)')
              : t('Ask Pi (Ctrl+Enter to send)')
          }
          rows={3}
          onChange={(e) => setInput(e.target.value)}
          onPaste={(e) => {
            const file = Array.from(e.clipboardData.items)
              .find((item) => item.kind === 'file' && item.type.startsWith('image/'))
              ?.getAsFile()
            if (file !== null && file !== undefined) {
              e.preventDefault()
              void pasteImage(file)
            }
          }}
          onKeyDown={(e) => {
            if (sendOnEnter) {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <button className="attach" title={t('Attach file')} onClick={() => void attachFile()} disabled={project === null}>
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button onClick={() => void send()} disabled={input.trim().length === 0}>
          {t('Send')}
        </button>
      </footer>
    </>
  )
}
