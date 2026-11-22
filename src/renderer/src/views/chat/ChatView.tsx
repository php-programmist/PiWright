import { useEffect, useMemo, useRef, useState } from 'react'
import { DialogCard } from '../../components/DialogCard'
import { Markdown } from '../../components/Markdown'
import { QueuePanel } from '../../components/QueuePanel'
import { TodoPanel } from '../../components/TodoPanel'
import { ToolBlock } from '../../components/ToolBlock'
import { useChatStore, atBottomMap, draftMap, loopExitMap, pendingImagesMap } from '../../stores/chat'
import type { Entry, HostChat, PendingImage } from '../../stores/chat'
import { useSessionsStore } from '../../stores/sessions'
import { cacheHitOf, percentColor } from '../../../../shared/agent-events'
import { base64FromBytes, removeAttachmentRef } from '../../../../shared/attachments'
import { PLAN_WIDGET_KEY, TODO_WIDGET_KEY, parseTodoLines } from '../../../../shared/todo'
import { useT } from '../../lib/i18n'
import { onPromptInject } from '../../lib/prompt-inject'
import { splitWorktreeHostDir } from '../../../../shared/worktree'
import type { DialogAnswer } from '../../../../shared/agent-events'
import type { AttachmentResult, PromptBehavior, QueueTexts } from '../../../../shared/ipc-contracts'

const STATUS_LABEL: Record<string, string> = {
  idle: 'idle',
  starting: 'starting…',
  ready: 'ready',
  streaming: 'streaming…',
  waiting: 'waiting…',
  disconnected: 'disconnected',
  error: 'error'
}

export interface UserEntry {
  kind: 'user'
  id: number
  text: string
}

export function EntryView({ entry, onAnswer, onEdit }: { entry: Entry; onAnswer: (dialogId: string, answer: DialogAnswer) => void; onEdit?: (entry: UserEntry, newText: string) => void }): React.JSX.Element | null {
  switch (entry.kind) {
    case 'user':
      return <UserMessage entry={entry} onEdit={onEdit} />
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

/** Пузырь пользователя; карандаш по ховеру открывает инлайн-редактор (порт MessageActions из jb-pi). */
function UserMessage({ entry, onEdit }: { entry: UserEntry; onEdit?: (entry: UserEntry, newText: string) => void }): React.JSX.Element {
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(entry.text)
  if (editing) {
    const submit = (): void => {
      setEditing(false)
      if (onEdit !== undefined && draft.trim().length > 0 && draft !== entry.text) onEdit(entry, draft)
    }
    return (
      <div className="user-message editing">
        <textarea
          className="user-edit-area"
          value={draft}
          rows={Math.min(10, draft.split('\n').length + 1)}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              submit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setEditing(false)
            }
          }}
        />
        <div className="user-edit-actions">
          <button onClick={() => setEditing(false)}>{t('Cancel')}</button>
          <button onClick={submit} disabled={draft.trim().length === 0 || draft === entry.text}>
            {t('Send')}
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="user-message">
      {entry.text}
      {onEdit !== undefined && (
        <button
          className="user-edit"
          title={t('Edit prompt and resend')}
          onClick={() => {
            setDraft(entry.text)
            setEditing(true)
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </div>
  )
}

export function ChatView({ chat }: { chat: HostChat | null }): React.JSX.Element {
  const activeHostId = useSessionsStore((s) => s.activeHostId)
  const placement = useSessionsStore((s) => s.settings?.selectorPlacement ?? 'top')
  const sendOnEnter = useSessionsStore((s) => s.settings?.sendOnEnter ?? false)
  const loopsEnabled = useSessionsStore((s) => s.settings?.loopsEnabled ?? false)
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
  const setLoopEnabled = useChatStore((s) => s.setLoopEnabled)
  const setLoopMax = useChatStore((s) => s.setLoopMax)
  const loop = chat?.loop ?? null
  const loopEnabled = chat?.loopEnabled ?? false
  const loopMax = chat?.loopMax ?? 20
  const loopActive = loop?.active ?? false
  const loopChecked = loopActive || loopEnabled
  const loopSplit = loopsEnabled && loopEnabled && !loopActive
  const toggleTelegram = useSessionsStore((s) => s.toggleTelegram)
  const toggleShare = useSessionsStore((s) => s.toggleShare)
  const telegramEnabled = useSessionsStore((s) => s.active.find((r) => r.hostId === s.activeHostId)?.telegram ?? false)
  const shared = useSessionsStore((s) => s.active.find((r) => r.hostId === s.activeHostId)?.shared ?? false)
  const [input, setInput] = useState(() => (activeHostId !== null ? draftMap.get(activeHostId) ?? '' : ''))
  useEffect(() => {
    if (activeHostId !== null) draftMap.set(activeHostId, input)
  }, [input, activeHostId])
  const [loopExit, setLoopExit] = useState(() => (activeHostId !== null ? loopExitMap.get(activeHostId) ?? '' : ''))
  useEffect(() => {
    if (activeHostId !== null) loopExitMap.set(activeHostId, loopExit)
  }, [loopExit, activeHostId])
  const [pendingImages, setPendingImages] = useState<PendingImage[]>(() =>
    activeHostId !== null ? pendingImagesMap.get(activeHostId) ?? [] : []
  )
  useEffect(() => {
    if (activeHostId !== null) pendingImagesMap.set(activeHostId, pendingImages)
  }, [pendingImages, activeHostId])
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const transcriptRef = useRef<HTMLElement | null>(null)
  const autoScrollRef = useRef(true)
  const project = useSessionsStore((s) => s.active.find((r) => r.hostId === activeHostId)?.project ?? null)
  const worktree = project !== null ? splitWorktreeHostDir(project.dir) : null

  const activeHostRef = useRef(activeHostId ?? '')
  useEffect(() => {
    activeHostRef.current = activeHostId ?? ''
  }, [activeHostId])
  useEffect(
    () =>
      onPromptInject((text) =>
        setInput((v) => `${v}${v.length > 0 && !v.endsWith(' ') ? ' ' : ''}${text} `)
      ),
    []
  )
  useEffect(() => () => {
    atBottomMap.delete(activeHostRef.current)
  }, [])

  // Чип адреса/PIN у расшаренной сессии: сервер мог подняться только что — поллим статус.
  const [remoteInfo, setRemoteInfo] = useState<Awaited<ReturnType<typeof window.piwright.remoteStatus>> | null>(null)
  useEffect(() => {
    if (!shared) return
    let alive = true
    const fetchInfo = (): void => {
      void window.piwright.remoteStatus().then((info) => {
        if (alive) setRemoteInfo(info)
      })
    }
    fetchInfo()
    const timer = setInterval(fetchInfo, 2000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [shared])
  const remoteStatusInfo = shared ? remoteInfo : null

  useEffect(() => {
    autoScrollRef.current = true
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

  const send = async (behavior?: PromptBehavior): Promise<void> => {
    const text = input.trim()
    if (text.length === 0) return
    const startingLoop = !streaming && loopsEnabled && loopEnabled && !loopActive
    // Чекбокс «Петля» обязывает прописать условие выхода — без него ход не отправляется.
    if (startingLoop && loopExit.trim().length === 0) return
    setInput('')
    addUserMessage(activeHostId, text)
    const images = pendingImages.map((img) => img.name)
    setPendingImages([])
    const effective = streaming ? (behavior ?? 'followUp') : undefined
    const result = await window.piwright.prompt(activeHostId, text, images, effective)
    if (!result.ok && result.error !== null) {
      applyEvent({ hostId: activeHostId, event: { type: 'turn_error', message: result.error } })
    }
    // Галка «Петля» + обычная отправка (не steer/followUp) — старт петли с этим промптом.
    if (result.ok && effective === undefined && startingLoop) {
      void window.piwright.loopStart(activeHostId, text, loopMax, loopExit.trim())
      setLoopEnabled(activeHostId, false)
    }
  }

  const restoreCleared = (cleared?: QueueTexts): void => {
    if (cleared === undefined) return
    const texts = [...cleared.steering, ...cleared.followUp]
    if (texts.length === 0) return
    setInput((v) => (v.length > 0 ? `${texts.join('\n\n')}\n\n${v}` : texts.join('\n\n')))
  }

  const clearQueue = async (): Promise<void> => {
    const result = await window.piwright.queueClear(activeHostId)
    if (!result.ok && result.error !== null) {
      applyEvent({ hostId: activeHostId, event: { type: 'turn_error', message: result.error } })
      return
    }
    restoreCleared(result.cleared)
  }

  const removeQueued = async (kind: keyof QueueTexts, index: number): Promise<void> => {
    const result = await window.piwright.queueRemove(activeHostId, kind, index)
    if (!result.ok && result.error !== null) {
      applyEvent({ hostId: activeHostId, event: { type: 'turn_error', message: result.error } })
      return
    }
    restoreCleared(result.cleared)
  }

  const insertAttachmentRef = (ref: string): void => {
    setInput((v) => `${v}${v.length > 0 && !v.endsWith(' ') ? ' ' : ''}${ref} `)
  }

  const addAttachment = (res: AttachmentResult): void => {
    if (!res.ok) return
    if (res.isImage) {
      setPendingImages((v) => [...v, { name: res.name, ref: res.ref, dataUrl: res.dataUrl }])
    }
    insertAttachmentRef(res.ref)
  }

  const attachFile = async (): Promise<void> => {
    if (project === null) return
    addAttachment(await window.piwright.chooseAttachment(project))
  }

  const saveAttachmentFile = async (file: File): Promise<void> => {
    if (project === null) return
    const bytes = new Uint8Array(await file.arrayBuffer())
    const res = await window.piwright.putAttachment(project, file.name.length > 0 ? file.name : 'pasted.png', base64FromBytes(bytes))
    addAttachment(res)
  }

  const removeImage = (img: PendingImage): void => {
    setPendingImages((v) => v.filter((p) => p.name !== img.name))
    setInput((v) => removeAttachmentRef(v, img.ref))
  }

  const abort = async (): Promise<void> => {
    const result = await window.piwright.abort(activeHostId)
    if (!result.ok && result.error !== null && result.error !== 'pi connection is not running') {
      applyEvent({ hostId: activeHostId, event: { type: 'turn_error', message: result.error } })
      return
    }
    restoreCleared(result.cleared)
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

  /** Редактирование промпта: fork сессии на момент сообщения + новый prompt; лента обрезается. */
  const submitEdit = async (entry: UserEntry, newText: string): Promise<void> => {
    if (activeHostId === null || streaming) return
    const index = entries.findIndex((e) => e.id === entry.id)
    if (index < 0) return
    const occurrence = entries.slice(index + 1).filter((e) => e.kind === 'user' && e.text === entry.text).length
    const result = await window.piwright.editPrompt(activeHostId, entry.text, occurrence, newText)
    if (!result.ok && result.error !== null) {
      applyEvent({ hostId: activeHostId, event: { type: 'turn_error', message: result.error } })
      return
    }
    useChatStore.getState().truncateFrom(activeHostId, entry.id)
    addUserMessage(activeHostId, newText)
  }

  const answerDialog = async (dialogId: string, answer: DialogAnswer): Promise<void> => {
    setDialogReceipt(activeHostId, dialogId, answer.kind === 'cancelled' ? 'cancelled' : 'answered')
    const result = await window.piwright.respondDialog(activeHostId, dialogId, answer)
    if (!result.ok) {
      setDialogReceipt(activeHostId, dialogId, 'expired')
    }
  }

  const queuedCount = queue.steering.length + queue.followUp.length
  const loopReasonText = (reason: string): string =>
    reason === 'agent'
      ? t('the turn had no tool calls')
      : reason === 'exit'
        ? t('exit condition met')
        : reason === 'max'
        ? t('iteration limit reached')
        : reason === 'short-circuit'
          ? t('3 iterations in a row faster than 10 seconds')
          : reason === 'error'
            ? t('failed to start the next iteration')
            : t('stopped by user')
  const toggleLoop = (): void => {
    if (loopActive) {
      void window.piwright.loopStop(activeHostId)
      return
    }
    setLoopEnabled(activeHostId, !loopEnabled)
  }
  const changeLoopMax = (raw: string): void => {
    const value = Math.round(Number(raw))
    if (!Number.isFinite(value)) return
    const clamped = Math.min(999, Math.max(1, value))
    if (loopActive) void window.piwright.loopSetRemaining(activeHostId, clamped)
    else setLoopMax(activeHostId, clamped)
  }
  const modelKey = status.model
  const selectedModel = status.models.find((m) => `${m.provider}/${m.id}` === modelKey)
  const thinkingLevels = selectedModel !== undefined ? selectedModel.thinkingLevels : status.thinkingLevels
  const toolsHidden = chat?.toolsHidden ?? false
  const muted = chat?.muted ?? false
  const visibleEntries = toolsHidden
    ? entries.filter((e) => e.kind !== 'tool' && e.kind !== 'thinking')
    : entries
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
          {modelKey === null && (
            <option value="" disabled hidden>
              {t('model')}
            </option>
          )}
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
      {thinkingLevels.length > 0 && (
        <select
          className="thinking-select"
          value={status.thinkingLevel ?? ''}
          onChange={(e) => void window.piwright.setThinkingLevel(activeHostId, e.target.value)}
        >
          {status.thinkingLevel === null && (
            <option value="" disabled hidden>
              {t('thinking')}
            </option>
          )}
          {thinkingLevels.map((level) => (
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

  const loopControls = (
    <>
      <label className="loop-toggle" title={t('Loop: repeat this prompt in fresh sessions; the loop stops when the agent calls loop_stop over the exit condition')}>
        <input type="checkbox" checked={loopChecked} onChange={toggleLoop} />
        <span>{t('Loop')}</span>
      </label>
      {loopChecked && (
        <input
          className="loop-max"
          type="number"
          min={1}
          max={999}
          value={loopActive ? (loop?.remaining ?? loopMax) : loopMax}
          title={t('Loop iterations left')}
          onChange={(e) => changeLoopMax(e.target.value)}
        />
      )}
      {loop !== null && !loopActive && loop.reason !== null && (
        <span className="loop-stopped-text">
          {t('Loop stopped')}: {loopReasonText(loop.reason)}
        </span>
      )}
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
        {shared && remoteStatusInfo !== null && remoteStatusInfo.running && (
          <span
            className="remote-chip"
            title={remoteStatusInfo.lanAddresses
              .slice(1)
              .map((a) => `http://${a}:${remoteStatusInfo.port}/`)
              .join('\n')}
          >
            {remoteStatusInfo.lanAddresses.length > 0
              ? `http://${remoteStatusInfo.lanAddresses[0]}:${remoteStatusInfo.port}/`
              : `port ${remoteStatusInfo.port}`}{' '}
            · PIN {remoteStatusInfo.pin}
          </span>
        )}
        <button
          className="icon"
          title={shared ? t('Stop sharing this session with the phone') : t('Share this session with a phone on the same Wi-Fi')}
          style={shared ? { color: 'var(--accent)' } : undefined}
          onClick={() => activeHostId !== null && toggleShare(activeHostId)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <ellipse cx="12" cy="12" rx="4" ry="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M3.5 9h17M3.5 15h17" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>
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
          title={telegramEnabled ? t('Disable Telegram notifications for this session') : t('Enable Telegram notifications for this session')}
          style={telegramEnabled ? { color: 'var(--accent)' } : undefined}
          onClick={() => activeHostId !== null && toggleTelegram(activeHostId)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M21.5 3.5L2.8 10.7c-.8.3-.8 1.4 0 1.7l4.6 1.6 1.8 5.5c.2.7 1.1.9 1.6.3l2.6-2.9 4.7 3.4c.6.4 1.4.1 1.6-.6l3-14.7c.2-.9-.7-1.7-1.6-1.4z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            <path d="M7.4 14l11.3-8.6" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
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
      {queuedCount > 0 && <QueuePanel queue={queue} onRemove={(kind, index) => void removeQueued(kind, index)} onClearAll={() => void clearQueue()} />}
      {todoItems.length > 0 && <TodoPanel items={todoItems} />}
      <main className="transcript" ref={transcriptRef} onScroll={handleScroll}>
        {visibleEntries.map((entry) => (
          <EntryView
            key={entry.id}
            entry={entry}
            onAnswer={(id, answer) => void answerDialog(id, answer)}
            onEdit={streaming ? undefined : (e, text) => void submitEdit(e, text)}
          />
        ))}
        {streaming && <div className="cursor">▍</div>}
        <div ref={bottomRef} />
      </main>
      {placement === 'bottom' ? (
        <div className="selector-bar">{controls}{loopsEnabled && loopControls}</div>
      ) : loopsEnabled ? (
        <div className="loop-bar">{loopControls}</div>
      ) : null}
      <footer
        className="composer"
        onDragOver={(e) => {
          if (project !== null) e.preventDefault()
        }}
        onDrop={(e) => {
          if (project === null) return
          e.preventDefault()
          for (const file of Array.from(e.dataTransfer.files)) void saveAttachmentFile(file)
        }}
      >
        <div className="composer-fields">
        {pendingImages.length > 0 && (
          <div className="pending-images">
            {pendingImages.map((img) => (
              <div className="pending-image" key={img.name} title={img.name}>
                {img.dataUrl.length > 0 ? <img src={img.dataUrl} alt={img.name} draggable={false} /> : <span className="pending-image-name">{img.name}</span>}
                <button
                  className="pending-image-remove"
                  title={t('Remove image')}
                  onClick={() => removeImage(img)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          value={input}
          placeholder={
            sendOnEnter
              ? t('Ask Pi (Enter to send, Shift+Enter for newline)')
              : t('Ask Pi (Ctrl+Enter to send)')
          }
          rows={loopSplit ? 2 : 3}
          onChange={(e) => setInput(e.target.value)}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData.items)
              .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
              .map((item) => item.getAsFile())
              .filter((file): file is File => file !== null)
            if (files.length > 0) {
              e.preventDefault()
              for (const file of files) void saveAttachmentFile(file)
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
        {loopSplit && (
          <textarea
            className="loop-exit"
            value={loopExit}
            placeholder={t('Loop exit condition (required): the loop stops when the agent calls loop_stop')}
            rows={1}
            onChange={(e) => setLoopExit(e.target.value)}
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
        )}
        </div>
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
        {streaming && (
          <button
            className="steer"
            title={t("Deliver before the agent's next step instead of after the turn")}
            onClick={() => void send('steer')}
            disabled={input.trim().length === 0}
          >
            {t('Steer')}
          </button>
        )}
        <button onClick={() => void send()} disabled={input.trim().length === 0 || (loopSplit && loopExit.trim().length === 0)}>
          {t('Send')}
        </button>
      </footer>
    </>
  )
}
