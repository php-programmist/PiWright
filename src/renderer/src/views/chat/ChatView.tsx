import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DialogCard } from '../../components/DialogCard'
import { confirmDialog } from '../../components/ConfirmDialog'
import { Markdown } from '../../components/Markdown'
import { RichText } from '../../components/LinkChips'
import { Lightbox } from '../../components/Lightbox'
import { QueuePanel } from '../../components/QueuePanel'
import { ScheduledPanel } from '../../components/ScheduledPanel'
import { TodoPanel } from '../../components/TodoPanel'
import { ToolBlock } from '../../components/ToolBlock'
import { ThinkingLevelControl } from '../../components/ThinkingLevelControl'
import { ContextBreakdownControl } from '../../components/ContextBreakdownControl'
import { useChatStore, atBottomMap, draftMap, loopExitMap, pendingImagesMap } from '../../stores/chat'
import { useScheduledStore } from '../../stores/scheduled'
import type { Entry, HostChat, PendingImage } from '../../stores/chat'
import { useFeedWindow } from './useFeedWindow'
import { useSessionsStore } from '../../stores/sessions'
import { useTabsStore, parentTabKey } from '../../stores/tabs'
import { cacheHitOf } from '../../../../shared/agent-events'
import { base64FromBytes, isImageFilePath, removeAttachmentRef, splitAttachmentRefs } from '../../../../shared/attachments'
import { PLAN_WIDGET_KEY, TODO_WIDGET_KEY, parseTodoLines } from '../../../../shared/todo'
import { useT } from '../../lib/i18n'
import { formatCompactDuration } from '../../lib/duration'
import { onPromptInject } from '../../lib/prompt-inject'
import { sameProjectDir, splitWorktreeHostDir } from '../../../../shared/worktree'
import { slashTokenOf, filterSlashCommands } from '../../../../shared/slash-commands'
import type { DialogAnswer } from '../../../../shared/agent-events'
import type { PiSlashCommand } from '../../../../shared/protocol-types'
import type { AttachmentResult, ProjectEntry, PromptBehavior, QueueTexts, ScheduledTrigger } from '../../../../shared/ipc-contracts'

let lastModelsRefreshAt = 0

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

export interface TextEntry {
  kind: 'text'
  id: number
  text: string
}

function EntryViewBase({ entry, project, onAnswer, onEdit, onFork }: { entry: Entry; project: ProjectEntry | null; onAnswer: (dialogId: string, answer: DialogAnswer) => void; onEdit?: (entry: UserEntry, newText: string) => void; onFork?: (entry: TextEntry) => void }): React.JSX.Element | null {
  switch (entry.kind) {
    case 'user':
      return <UserMessage entry={entry} project={project} onEdit={onEdit} />
    case 'text':
      return <AssistantMessage entry={entry} project={project} onFork={onFork} />
    case 'thinking':
      return (
        <details className="thinking">
          <ChatThinkingSummary tps={entry.tps} />
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
      const ttft =
        speed?.ttftMs != null ? (speed.ttftMs < 1000 ? `${Math.round(speed.ttftMs)}ms` : `${(speed.ttftMs / 1000).toFixed(1)}s`) : null
      const parts = [
        entry.durationMs !== null ? `⏱ ${formatCompactDuration(entry.durationMs)}` : null,
        `in ${u.inputTokens.toLocaleString('en-US')}`,
        `out ${u.outputTokens.toLocaleString('en-US')}`,
        u.contextTokens !== null ? `ctx ${u.contextTokens.toLocaleString('en-US')}` : null,
        ttft !== null ? `TTFT ${ttft}` : null,
        speed?.tokensPerSecond != null ? `${Math.round(speed.tokensPerSecond)} tok/s` : null
      ].filter((p): p is string => p !== null)
      return <div className="turn-result">{parts.join(' · ')}</div>
    }
  }
}

/** Ре-рендер записи только при смене её объекта или колбэков: стриминг меняет лишь открытую запись. */
export const EntryView = memo(
  EntryViewBase,
  (a, b) => a.entry === b.entry && a.project === b.project && a.onAnswer === b.onAnswer && a.onEdit === b.onEdit && a.onFork === b.onFork
)

export function ChatThinkingSummary({ tps }: { tps?: number | null }): React.JSX.Element {
  const t = useT()
  return (
    <summary>
      {t('thinking')}
      {tps != null && <span className="thinking-tps"> · {Math.round(tps)} tok/s</span>}
    </summary>
  )
}

/** Ответ агента; кнопка под сообщением форкает сессию в новую с этого места (порт MessageActions из jb-pi). */
function AssistantMessage({ entry, project, onFork }: { entry: TextEntry; project: ProjectEntry | null; onFork?: (entry: TextEntry) => void }): React.JSX.Element {
  const t = useT()
  return (
    <div className="assistant-message">
      <RichText text={entry.text} project={project} renderText={(chunk) => <Markdown text={chunk} />} />
      {onFork !== undefined && (
        <button
          className="msg-action"
          title={t('Fork into a new session from this point')}
          onClick={() => onFork(entry)}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
            <line x1="6" y1="6" x2="6" y2="15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="18" cy="6" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <circle cx="6" cy="18" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M18 9a9 9 0 0 1-9 9" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  )
}

/** Превью вложения-картинки в сообщении пользователя: грузится из общей папки корня репо
 *  (`<root>/.pi/attachments/`, у worktree-сессий — из корня, не из worktree); клик — Lightbox.
 *  Пока не загрузилось или файл исчез — показываем текстовый ref. */
function UserAttachmentImage({ project, name, fallback }: { project: ProjectEntry | null; name: string; fallback: string }): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(null)
  const [zoom, setZoom] = useState(false)
  useEffect(() => {
    if (project === null) return
    let cancelled = false
    const baseDir = splitWorktreeHostDir(project.dir)?.root ?? project.dir
    void window.piwright.filesReadImage({ ...project, dir: baseDir }, `.pi/attachments/${name}`).then((r) => {
      if (!cancelled) setUrl(r.ok ? r.dataUrl : '')
    })
    return () => {
      cancelled = true
    }
  }, [project, name])
  if (url === null || url.length === 0) return <span className="user-attachment-ref">{fallback}</span>
  return (
    <>
      <img
        className="user-attachment"
        src={url}
        alt={name}
        title={name}
        draggable={false}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setZoom(true)
        }}
      />
      {zoom && <Lightbox src={url} alt={name} onClose={() => setZoom(false)} />}
    </>
  )
}

/** Пузырь пользователя; карандаш по ховеру открывает инлайн-редактор (порт MessageActions из jb-pi).
 *  Ref-ы вложений-картинок рендерятся миниатюрами, остальные ref-ы — текстом. */
function UserMessage({ entry, project, onEdit }: { entry: UserEntry; project: ProjectEntry | null; onEdit?: (entry: UserEntry, newText: string) => void }): React.JSX.Element {
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(entry.text)
  if (editing) {
    const submit = (): void => {
      setEditing(false)
      if (onEdit !== undefined && draft.trim().length > 0 && draft !== entry.text) onEdit(entry, draft)
    }
    return (
      <div className="user-entry editing">
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
      </div>
    )
  }
  return (
    <div className="user-entry">
      <div className="user-message">
        {splitAttachmentRefs(entry.text).map((seg, i) =>
          seg.kind === 'text' ? (
            <RichText key={i} text={seg.text} project={project} />
          ) : isImageFilePath(seg.name) ? (
            <UserAttachmentImage key={i} project={project} name={seg.name} fallback={seg.ref} />
          ) : (
            <span key={i}>{seg.ref}</span>
          )
        )}
      </div>
      {onEdit !== undefined && (
        <button
          className="msg-action"
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

/** Живой счётчик времени хода: тикает раз в секунду, пока идёт ход; фикс. ширина — цифры не двигают соседей. */
function TurnTimer({ startedAt }: { startedAt: number }): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return <span className="turn-timer">⏱ {formatCompactDuration(now - startedAt)}</span>
}

export function ChatView({ chat }: { chat: HostChat | null }): React.JSX.Element {
  const activeHostId = useSessionsStore((s) => s.activeHostId)
  const placement = useSessionsStore((s) => s.settings?.selectorPlacement ?? 'top')
  const sendOnEnter = useSessionsStore((s) => s.settings?.sendOnEnter ?? true)
  const loopsEnabled = useSessionsStore((s) => s.settings?.loopsEnabled ?? false)
  const t = useT()
  const status = chat?.status ?? null
  const entries = useMemo(() => chat?.entries ?? [], [chat])
  const streaming = chat?.streaming ?? false
  const turnStartedAt = chat?.turnStartedAt ?? null
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
  const [pendingZoom, setPendingZoom] = useState<{ src: string; name: string } | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const transcriptRef = useRef<HTMLElement | null>(null)
  const autoScrollRef = useRef(true)
  const promptRef = useRef<HTMLTextAreaElement | null>(null)
  const loopExitRef = useRef<HTMLTextAreaElement | null>(null)
  const fieldsRef = useRef<HTMLDivElement | null>(null)
  // Высота блока полей ввода (px); null — авто по содержимому. Меняется перетаскиванием верхней границы композера.
  const [fieldsHeight, setFieldsHeight] = useState<number | null>(null)

  /** Линия текста и вертикальные отступы с рамкой поля ввода. */
  const fieldMetrics = (ta: HTMLTextAreaElement): { line: number; pad: number } => {
    const cs = getComputedStyle(ta)
    const lh = Number.parseFloat(cs.lineHeight)
    const padRaw =
      Number.parseFloat(cs.paddingTop) +
      Number.parseFloat(cs.paddingBottom) +
      Number.parseFloat(cs.borderTopWidth) +
      Number.parseFloat(cs.borderBottomWidth)
    return { line: Number.isFinite(lh) ? lh : 18, pad: Number.isFinite(padRaw) ? padRaw : 18 }
  }

  // Авто-рост полей по содержимому, пока высота не задана перетаскиванием: промпт до 15 строк,
  // условие выхода до 6; дальше — внутренний скролл (референс jb-pi: 3..15 строк).
  useEffect(() => {
    if (fieldsHeight !== null) {
      for (const ta of [promptRef.current, loopExitRef.current]) {
        if (ta !== null) {
          ta.style.flex = ''
          ta.style.height = ''
        }
      }
      return
    }
    const grow = (ta: HTMLTextAreaElement, maxLines: number): void => {
      const { line, pad } = fieldMetrics(ta)
      // flex: 0 0 auto — иначе flex-basis 0% из .composer textarea перебивает inline-height
      ta.style.flex = '0 0 auto'
      ta.style.height = 'auto'
      let target = ta.scrollHeight
      // Пустое поле с длинным placeholder: scrollHeight его не учитывает — меряем подставив его в value
      if (ta.value === '' && ta.placeholder !== '') {
        ta.value = ta.placeholder
        target = Math.max(target, ta.scrollHeight)
        ta.value = ''
      }
      ta.style.height = `${Math.min(target, line * maxLines + pad)}px`
    }
    if (promptRef.current !== null) grow(promptRef.current, 15)
    if (loopExitRef.current !== null) grow(loopExitRef.current, 6)
  }, [input, loopExit, loopSplit, fieldsHeight])

  /** Перетаскивание верхней границы композера: блок полей растёт вверх, оба поля делят высоту. */
  const onComposerResizeStart = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    const fields = fieldsRef.current
    if (fields === null) return
    e.preventDefault()
    const startY = e.clientY
    const startH = fields.offsetHeight
    const pm = promptRef.current !== null ? fieldMetrics(promptRef.current) : { line: 18, pad: 18 }
    const em = loopExitRef.current !== null ? fieldMetrics(loopExitRef.current) : pm
    const exitSpace = loopSplit ? em.line + em.pad + 6 : 0
    const min = (loopSplit ? 2 : 3) * pm.line + pm.pad + exitSpace
    const max = Math.max(min, Math.min(pm.line * 15 + pm.pad + exitSpace, window.innerHeight - 240))
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    const move = (ev: PointerEvent): void => {
      setFieldsHeight(Math.min(max, Math.max(min, startH + (startY - ev.clientY))))
    }
    const up = (): void => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', up)
      handle.removeEventListener('pointercancel', up)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', up)
    handle.addEventListener('pointercancel', up)
  }
  const toolsHidden = chat?.toolsHidden ?? false
  const handleFeedScroll = useCallback((atBottom: boolean) => {
    if (activeHostId === null) return
    autoScrollRef.current = atBottom
    atBottomMap.set(activeHostId, atBottom)
    if (atBottom) useChatStore.getState().markRead(activeHostId)
  }, [activeHostId])
  const feed = useFeedWindow(entries, transcriptRef, { onScroll: handleFeedScroll })
  // Окно по всем записям, фильтр инструментов — после окна: windowStart в координатах полной ленты.
  const windowed = entries.slice(feed.windowStart)
  const visibleEntries = toolsHidden ? windowed.filter((e) => e.kind !== 'tool' && e.kind !== 'thinking') : windowed

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

  /** Форк сессии после ответа агента в новую сессию (родитель не трогается): точка — следующий
   *  за ответом промпт; после последнего ответа — клон всей сессии. Новая сессия открывается активной. */
  const forkFrom = async (entry: TextEntry): Promise<void> => {
    if (activeHostId === null || streaming) return
    const index = entries.findIndex((e) => e.id === entry.id)
    if (index < 0) return
    const nextUser = entries.slice(index + 1).find((e): e is UserEntry => e.kind === 'user')
    let userText: string | null = null
    let occurrence = 0
    if (nextUser !== undefined) {
      userText = nextUser.text
      const userIndex = entries.findIndex((e) => e.id === nextUser.id)
      occurrence = entries.slice(userIndex + 1).filter((e) => e.kind === 'user' && e.text === nextUser.text).length
    }
    const result = await window.piwright.forkSession(activeHostId, userText, occurrence)
    if (!result.ok || result.hostId === undefined) {
      if (result.error !== null) {
        applyEvent({ hostId: activeHostId, event: { type: 'turn_error', message: result.error } })
      }
      return
    }
    const row = useSessionsStore.getState().active.find((r) => r.hostId === activeHostId)
    if (row !== undefined) {
      useTabsStore.getState().setActiveProject(parentTabKey(row.project))
      useTabsStore.getState().activateSession(row.project)
    }
    useSessionsStore.getState().setActive(result.hostId)
  }

  const answerDialog = async (dialogId: string, answer: DialogAnswer): Promise<void> => {
    if (activeHostId === null) return
    setDialogReceipt(activeHostId, dialogId, answer.kind === 'cancelled' ? 'cancelled' : 'answered')
    const result = await window.piwright.respondDialog(activeHostId, dialogId, answer)
    if (!result.ok) {
      setDialogReceipt(activeHostId, dialogId, 'expired')
    }
  }

  // Стабильные колбэки для memo(EntryView): свежие версии функций добираются через ref.
  const actionsRef = useRef<{ answerDialog: typeof answerDialog; submitEdit: typeof submitEdit; forkFrom: typeof forkFrom } | null>(null)
  useEffect(() => {
    actionsRef.current = { answerDialog, submitEdit, forkFrom }
  })
  const stableAnswer = useCallback((dialogId: string, answer: DialogAnswer) => {
    const actions = actionsRef.current
    if (actions !== null) void actions.answerDialog(dialogId, answer)
  }, [])
  const stableEdit = useCallback((e: UserEntry, text: string) => {
    const actions = actionsRef.current
    if (actions !== null) void actions.submitEdit(e, text)
  }, [])
  const stableFork = useCallback((e: TextEntry) => {
    const actions = actionsRef.current
    if (actions !== null) void actions.forkFrom(e)
  }, [])
  const project = useSessionsStore((s) => s.active.find((r) => r.hostId === activeHostId)?.project ?? null)
  const worktree = project !== null ? splitWorktreeHostDir(project.dir) : null

  // Отложенные промпты (очередь сессий): меню ПКМ по Send + панель в футере.
  const [schedMenuOpen, setSchedMenuOpen] = useState(false)
  const [schedAt, setSchedAt] = useState('')
  const schedMenuRef = useRef<HTMLDivElement | null>(null)
  const sessionRows = useSessionsStore((s) => s.active)
  const scheduledItems = useScheduledStore((s) => s.items)
  const busySessions = useMemo(() => sessionRows.filter((r) => r.state === 'streaming' || r.state === 'waiting'), [sessionRows])
  const scheduledForHost = useMemo(() => scheduledItems.filter((i) => i.targetHostId === activeHostId), [scheduledItems, activeHostId])
  useEffect(() => {
    if (!schedMenuOpen) return
    const onDown = (e: MouseEvent): void => {
      if (schedMenuRef.current !== null && !schedMenuRef.current.contains(e.target as Node)) setSchedMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [schedMenuOpen])

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

  const [slashItems, setSlashItems] = useState<PiSlashCommand[] | null>(null)
  const [slashIndex, setSlashIndex] = useState(0)
  const slashCacheRef = useRef<Map<string, PiSlashCommand[]>>(new Map())
  const slashDismissedRef = useRef<string | null>(null)
  const slashMenuRef = useRef<HTMLDivElement | null>(null)
  const prevSlashTokenRef = useRef<string | null>(null)
  const slashToken = slashTokenOf(input)
  useEffect(() => {
    if (activeHostId === null) return
    const current = slashTokenOf(input)
    const fresh = prevSlashTokenRef.current === null
    prevSlashTokenRef.current = current
    if (current === null || current === slashDismissedRef.current) {
      setSlashItems(null)
      return
    }
    slashDismissedRef.current = null
    const cached = fresh ? undefined : slashCacheRef.current.get(activeHostId)
    if (cached !== undefined) {
      setSlashItems(cached)
      return
    }
    let cancelled = false
    void window.piwright.sessionCommands(activeHostId).then((r) => {
      if (cancelled) return
      const list = r.ok ? r.commands : []
      slashCacheRef.current.set(activeHostId, list)
      setSlashItems(list)
    })
    return () => {
      cancelled = true
    }
  }, [input, activeHostId])
  const [prevSlashToken, setPrevSlashToken] = useState<string | null>(slashToken)
  if (prevSlashToken !== slashToken) {
    setPrevSlashToken(slashToken)
    setSlashIndex(0)
  }
  const slashFiltered = useMemo(
    () => (slashItems === null || slashToken === null ? [] : filterSlashCommands(slashItems, slashToken)),
    [slashItems, slashToken]
  )
  const slashActive = slashFiltered.length > 0
  const slashCurrent = slashActive ? slashFiltered[Math.min(slashIndex, slashFiltered.length - 1)] : null
  const applySlash = (name: string): void => {
    setInput(`/${name} `)
    setSlashItems(null)
  }
  useEffect(() => {
    if (!slashActive) return
    const onDown = (e: MouseEvent): void => {
      if (slashMenuRef.current !== null && !slashMenuRef.current.contains(e.target as Node)) setSlashItems(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [slashActive])

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

  // Прибитый к низу скролл: прыжок на дно. Реплей истории приходит одной пачкой — прыгаем
  // без smooth-анимации через всю ленту; окно на хвост сбрасывает сам useFeedWindow.
  const prevLenRef = useRef(entries.length)
  useEffect(() => {
    const batch = entries.length - prevLenRef.current > 5
    prevLenRef.current = entries.length
    if (!autoScrollRef.current || activeHostId === null) return
    atBottomMap.set(activeHostId, true)
    useChatStore.getState().markRead(activeHostId)
    bottomRef.current?.scrollIntoView({ behavior: streaming || batch ? 'auto' : 'smooth' })
  }, [entries, streaming, activeHostId])

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
    setInput('')
    const images = pendingImages.map((img) => img.name)
    setPendingImages([])
    const effective = streaming ? (behavior ?? 'followUp') : undefined
    // Очередное сообщение (при ходе) в ленту не дублируем: покажется эхом user_message при доставке.
    if (effective === undefined) addUserMessage(activeHostId, text)
    // Петля поднимается до отправки: prompt резолвится уже после agent_start первого хода,
    // и контроллер не увидел бы его начала — рабочий ход остался бы без отслеживания.
    if (startingLoop) await window.piwright.loopStart(activeHostId, text, loopMax, loopExit.trim())
    const result = await window.piwright.prompt(activeHostId, text, images, effective)
    if (!result.ok && result.error !== null) {
      // Очередное не попало ни в ленту, ни в очередь — возвращаем в поле ввода.
      if (effective !== undefined) setInput((v) => (v.length > 0 ? `${text}\n\n${v}` : text))
      applyEvent({ hostId: activeHostId, event: { type: 'turn_error', message: result.error } })
    }
    if (!result.ok && startingLoop) void window.piwright.loopStop(activeHostId)
    // Галка «Петля» + обычная отправка (не steer/followUp) — старт петли с этим промптом.
    if (result.ok && startingLoop) setLoopEnabled(activeHostId, false)
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

  // Редактирование в очереди = снять элемент в поле ввода (остальные остаются в очереди).
  const editQueued = async (kind: keyof QueueTexts, index: number): Promise<void> => {
    const result = await window.piwright.queueTake(activeHostId, kind, index)
    if (!result.ok && result.error !== null) {
      applyEvent({ hostId: activeHostId, event: { type: 'turn_error', message: result.error } })
      return
    }
    restoreCleared(result.cleared)
  }

  const convertQueued = async (kind: keyof QueueTexts, index: number): Promise<void> => {
    const toKind: keyof QueueTexts = kind === 'steering' ? 'followUp' : 'steering'
    const result = await window.piwright.queueConvert(activeHostId, kind, index, toKind)
    if (!result.ok && result.error !== null) {
      applyEvent({ hostId: activeHostId, event: { type: 'turn_error', message: result.error } })
      return
    }
    restoreCleared(result.cleared)
  }

  // Отложенная отправка: текст и картинки из композера, настройки — текущие цели (фиксируются при планировании).
  // Галка «Петля» уходит в элемент: при срабатывании петля стартует так же, как при обычной отправке.
  const schedulePrompt = async (trigger: ScheduledTrigger): Promise<void> => {
    const text = input.trim()
    if (text.length === 0 || activeHostId === null) return
    const startingLoop = !streaming && loopsEnabled && loopEnabled && !loopActive
    const ok = await useScheduledStore.getState().schedule({
      targetHostId: activeHostId,
      text,
      images: pendingImages.map((img) => img.name),
      model: status.model,
      thinkingLevel: status.thinkingLevel,
      trigger,
      loop: startingLoop ? { maxIterations: loopMax, exitCondition: loopExit.trim() } : null
    })
    if (ok) {
      setInput('')
      setPendingImages([])
      setSchedAt('')
      setSchedMenuOpen(false)
    }
  }
  const scheduleAt = (): void => {
    const at = new Date(schedAt).getTime()
    if (!Number.isFinite(at)) return
    void schedulePrompt({ kind: 'at', atEpochMs: at })
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
    const siblings = useSessionsStore.getState().active.filter((r) => {
      const w = splitWorktreeHostDir(r.project.dir)
      return w !== null && w.name === worktree.name && sameProjectDir(w.root, worktree.root)
    })
    const hostIds = [...new Set(siblings.map((r) => r.hostId))]
    const closingNote = hostIds.length > 0 ? t('\n\nRunning sessions ({count}) will be closed.', { count: hostIds.length }) : ''
    if (!(await confirmDialog({ message: t("Remove worktree '{name}'?", { name: worktree.name }) + closingNote, confirmLabel: t('Delete'), danger: true }))) return
    let result = await window.piwright.worktreeRemove(project, worktree.name, false, hostIds)
    if (!result.ok && result.uncommitted && (await confirmDialog({ message: t('There are uncommitted changes. Force remove?') }))) {
      result = await window.piwright.worktreeRemove(project, worktree.name, true, hostIds)
    }
    if (!result.ok) {
      window.alert(result.error)
      return
    }
    for (const hostId of hostIds) {
      useChatStore.getState().removeHost(hostId)
      useSessionsStore.getState().forgetHost(hostId)
    }
  }

  const queuedCount = queue.steering.length + queue.followUp.length
  const turnTicker =
    streaming && turnStartedAt !== null ? (
      <>
        {chat?.streamTps != null && <span className="turn-tps">{Math.round(chat.streamTps)} tok/s</span>}
        <TurnTimer startedAt={turnStartedAt} />
      </>
    ) : null
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
  // Правка models.json вне приложения: дропдаун моделей — последний шанс догнать каталог,
  // фокус-рефреш мог не сработать; троттлинг 5 с, чтобы не дёргать pi на каждый клик.
  const refreshModelsOnOpen = useRef(() => {
    if (Date.now() - lastModelsRefreshAt < 5000) return
    lastModelsRefreshAt = Date.now()
    void window.piwright.modelsRefresh().catch(() => {})
  })
  const selectedModel = status.models.find((m) => `${m.provider}/${m.id}` === modelKey)
  const thinkingLevels = selectedModel !== undefined ? selectedModel.thinkingLevels : status.thinkingLevels
  const muted = chat?.muted ?? false
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
          onMouseDown={() => refreshModelsOnOpen.current()}
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
        <ThinkingLevelControl
          levels={thinkingLevels}
          current={status.thinkingLevel}
          onChange={(level) => void window.piwright.setThinkingLevel(activeHostId, level)}
        />
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
        <ContextBreakdownControl hostId={activeHostId} percent={ctxPercent} title={ctxTitle()} />
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
        <span className="spacer" />
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
      </header>
      {status.error !== null && <div className="error">{status.error}</div>}
      {queuedCount > 0 && (
        <QueuePanel
          queue={queue}
          onRemove={(kind, index) => void removeQueued(kind, index)}
          onEdit={(kind, index) => void editQueued(kind, index)}
          onConvert={(kind, index) => void convertQueued(kind, index)}
          onClearAll={() => void clearQueue()}
        />
      )}
      <ScheduledPanel items={scheduledForHost} onCancel={(id) => void useScheduledStore.getState().cancel(id)} />
      {todoItems.length > 0 && <TodoPanel items={todoItems} />}
      <main className="transcript" ref={transcriptRef} onScroll={feed.handleScroll}>
        {visibleEntries.map((entry) => (
          <EntryView
            key={entry.id}
            entry={entry}
            project={project}
            onAnswer={stableAnswer}
            onEdit={streaming ? undefined : stableEdit}
            onFork={streaming ? undefined : stableFork}
          />
        ))}
        {streaming && <div className="cursor">▍</div>}
        <div ref={bottomRef} />
      </main>
      {placement === 'bottom' ? (
        <div className="selector-bar">{controls}{loopsEnabled && loopControls}<span className="spacer" />{turnTicker}</div>
      ) : loopsEnabled || turnTicker !== null ? (
        <div className="loop-bar">{loopsEnabled && loopControls}<span className="spacer" />{turnTicker}</div>
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
        <div
          className="composer-resize"
          title={t('Drag to resize, double-click to reset')}
          onPointerDown={onComposerResizeStart}
          onDoubleClick={() => setFieldsHeight(null)}
        />
        <div
          className={`composer-fields${fieldsHeight !== null ? ' sized' : ''}`}
          ref={fieldsRef}
          style={fieldsHeight !== null ? { height: fieldsHeight } : undefined}
        >
        {slashActive && (
          <div className="slash-menu" ref={slashMenuRef} role="listbox">
            {slashFiltered.map((c, i) => (
              <button
                key={`${c.name}:${i}`}
                type="button"
                className={`slash-item${i === Math.min(slashIndex, slashFiltered.length - 1) ? ' current' : ''}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => applySlash(c.name)}
                onMouseEnter={() => setSlashIndex(i)}
              >
                <span className="slash-name">/{c.name}</span>
                {c.description !== null && <span className="slash-desc">{c.description}</span>}
                {c.source !== null && <span className="slash-source">{c.source}</span>}
              </button>
            ))}
          </div>
        )}
        {pendingImages.length > 0 && (
          <div className="pending-images">
            {pendingImages.map((img) => (
              <div className="pending-image" key={img.name} title={img.name}>
                {img.dataUrl.length > 0 ? (
                  <img
                    src={img.dataUrl}
                    alt={img.name}
                    draggable={false}
                    title={t('Click to view')}
                    onClick={() => setPendingZoom({ src: img.dataUrl, name: img.name })}
                  />
                ) : (
                  <span className="pending-image-name">{img.name}</span>
                )}
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
        {pendingZoom !== null && <Lightbox src={pendingZoom.src} alt={pendingZoom.name} onClose={() => setPendingZoom(null)} />}
        <textarea
          ref={promptRef}
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
            if (slashActive) {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSlashIndex((i) => (i + 1) % slashFiltered.length)
                return
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSlashIndex((i) => (i - 1 + slashFiltered.length) % slashFiltered.length)
                return
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault()
                if (slashCurrent !== null) applySlash(slashCurrent.name)
                return
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                slashDismissedRef.current = slashToken
                setSlashItems(null)
                return
              }
            }
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
            ref={loopExitRef}
            value={loopExit}
            placeholder={t('Loop exit condition (optional): the loop stops when the agent calls loop_stop; empty — the loop runs until the iteration limit')}
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
        <div className="send-wrap" onContextMenu={(e) => {
          if (input.trim().length === 0) return
          e.preventDefault()
          setSchedMenuOpen(true)
        }}>
          <button onClick={() => void send()} disabled={input.trim().length === 0}>
            {t('Send')}
          </button>
          {schedMenuOpen && (
            <div className="sched-menu" ref={schedMenuRef}>
              <div className="sched-menu-title">{t('Run after…')}</div>
              {busySessions.length === 0 && <div className="sched-menu-empty">{t('No sessions with a running turn')}</div>}
              {busySessions.map((r) => (
                <button key={r.hostId} type="button" className="sched-item" onClick={() => void schedulePrompt({ kind: 'after', sourceHostId: r.hostId, sourceTitle: r.title })}>
                  <span className="sched-name">{r.title}</span>
                  <span className="sched-desc">{r.project.dir}</span>
                </button>
              ))}
              <div className="sched-menu-title">{t('Send at…')}</div>
              <div className="sched-time-row">
                <input
                  type="datetime-local"
                  className="sched-time"
                  value={schedAt}
                  onChange={(e) => setSchedAt(e.target.value)}
                />
                <button type="button" className="sched-apply" disabled={schedAt === ''} onClick={scheduleAt}>
                  {t('OK')}
                </button>
              </div>
            </div>
          )}
        </div>
      </footer>
    </>
  )
}
