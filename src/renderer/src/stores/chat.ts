import { create } from 'zustand'
import { compactionBannerText, compactionSummaryText } from '../../../shared/agent-events'
import type { ExtensionDialog, SessionTokens, ToolCall, ToolResult, TurnUsage, UiEvent } from '../../../shared/agent-events'
import type { PiEventMessage, PiStatus } from '../../../shared/ipc-contracts'

export interface ToolEntry {
  kind: 'tool'
  id: number
  call: ToolCall
  partial: string
  result: ToolResult | null
  /** Вызовы, сделанные этим инструментом (nested/субагент, `parentToolCallId`). */
  children: ToolEntry[]
}

export type Entry =
  | { kind: 'user'; id: number; text: string }
  | { kind: 'text'; id: number; text: string; open: boolean }
  | { kind: 'thinking'; id: number; text: string; open: boolean }
  | ToolEntry
  | { kind: 'dialog'; id: number; dialogId: string; dialog: ExtensionDialog; receipt: string | null }
  | { kind: 'info'; id: number; text: string }
  | { kind: 'error'; id: number; text: string }
  | { kind: 'result'; id: number; usage: TurnUsage }

export interface QueueState {
  steering: string[]
  followUp: string[]
}

/** Состояние чата одной сессии; реестр по hostId живёт в store. */
export interface HostChat {
  status: PiStatus | null
  entries: Entry[]
  streaming: boolean
  queue: QueueState
  contextUsage: { used: number; size: number } | null
  /** Суммарные токены сессии (`get_session_stats`) — тултип процента контекста. */
  usageTotals: SessionTokens | null
  /** Статус-строки расширений (LSP и др.): key → text. */
  extensionStatuses: Record<string, string>
  /** Виджеты расширений (todo): key → строки. */
  widgets: Record<string, string[]>
  toolsHidden: boolean
  /** Звуки этой сессии выключены (кнопка-колокольчик в шапке; не персистится). */
  muted: boolean
  /** Ход завершился, а сессия не долистана/работала в фоне — зелёная точка в панели. */
  unread: boolean
}

interface ChatState {
  hosts: Record<string, HostChat>
  applyEvent: (message: PiEventMessage) => void
  applyStatus: (status: PiStatus) => void
  removeHost: (hostId: string) => void
  addUserMessage: (hostId: string, text: string) => void
  setDialogReceipt: (hostId: string, dialogId: string, receipt: string) => void
  toggleToolsHidden: (hostId: string) => void
  toggleMuted: (hostId: string) => void
  markUnread: (hostId: string) => void
  markRead: (hostId: string) => void
  resetTranscript: (hostId: string) => void
}

/** Дельты копятся в буфере и попадают в state раз в ~150 мс — markdown не перерисовывается на каждый кадр. */
const FLUSH_INTERVAL_MS = 150

let nextEntryId = 1

interface HostBuffers {
  pendingText: string
  pendingThought: string
  flushTimer: ReturnType<typeof setTimeout> | null
}

const buffers = new Map<string, HostBuffers>()
/** Сколько только что отправленных сообщений ещё не вернулось эхом (`user_message`) —
 *  их уже показали в ленте. Остальные эхо — доставки из очереди, их рисуем при доставке. */
const ownEchoes = new Map<string, number>()

/** «На дне» ленты по hostId — пишет ChatView, читает App на turn_end (вне reactive-стора:
 *  скролл частый, ререндер не нужен). Нет записи = сессия не видна (фон). */
export const atBottomMap = new Map<string, boolean>()

/** Черновик промпта по hostId (вне reactive-стора: пишет и читает только ChatView). */
export const draftMap = new Map<string, string>()

function newId(): number {
  return nextEntryId++
}

function hostBuffers(hostId: string): HostBuffers {
  const existing = buffers.get(hostId)
  if (existing !== undefined) return existing
  const created: HostBuffers = { pendingText: '', pendingThought: '', flushTimer: null }
  buffers.set(hostId, created)
  return created
}

function emptyHostChat(): HostChat {
  return {
    status: null,
    entries: [],
    streaming: false,
    queue: { steering: [], followUp: [] },
    contextUsage: null,
    usageTotals: null,
    extensionStatuses: {},
    widgets: {},
    toolsHidden: false,
    muted: false,
    unread: false
  }
}

function resetBuffers(hostId: string): void {
  const b = buffers.get(hostId)
  if (b !== undefined) {
    b.pendingText = ''
    b.pendingThought = ''
    if (b.flushTimer !== null) {
      clearTimeout(b.flushTimer)
      b.flushTimer = null
    }
  }
  ownEchoes.set(hostId, 0)
}

/** Прикладывает накопленные дельты: текст/thinking дописывают открытую запись или открывают новую. */
function withFlushed(hostId: string, host: HostChat): HostChat {
  const b = hostBuffers(hostId)
  if (b.pendingText.length === 0 && b.pendingThought.length === 0) return host
  const entries = [...host.entries]
  if (b.pendingThought.length > 0) {
    const last = entries[entries.length - 1]
    if (last?.kind === 'thinking' && last.open) {
      entries[entries.length - 1] = { ...last, text: last.text + b.pendingThought }
    } else {
      entries.push({ kind: 'thinking', id: newId(), text: b.pendingThought, open: true })
    }
    b.pendingThought = ''
  }
  if (b.pendingText.length > 0) {
    const last = entries[entries.length - 1]
    if (last?.kind === 'text' && last.open) {
      entries[entries.length - 1] = { ...last, text: last.text + b.pendingText }
    } else {
      entries.push({ kind: 'text', id: newId(), text: b.pendingText, open: true })
    }
    b.pendingText = ''
  }
  return { ...host, entries }
}

function closeOpenBlocks(entries: Entry[]): Entry[] {
  return entries.map((e) =>
    (e.kind === 'text' || e.kind === 'thinking') && e.open ? { ...e, open: false } : e
  )
}

/** Рекурсивная замена тул-записи; false — id не найден. */
function mapToolEntry(entries: Entry[], callId: string, fn: (t: ToolEntry) => ToolEntry): boolean {
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i]
    if (e.kind !== 'tool') continue
    if (e.call.id === callId) {
      entries[i] = fn(e)
      return true
    }
    const children = [...e.children]
    if (mapToolEntry(children, callId, fn)) {
      entries[i] = { ...e, children }
      return true
    }
  }
  return false
}

/** Вложить дочерний вызов в родителя; false — родитель не найден. */
function appendChildTool(entries: Entry[], parentId: string, child: ToolEntry): boolean {
  return mapToolEntry(entries, parentId, (t) => ({ ...t, children: [...t.children, child] }))
}

/** Лента транскрипта исторической сессии из UiEvent-ов реплея (без буферов и статусов). */
export function transcriptEntries(events: UiEvent[]): Entry[] {
  const entries: Entry[] = []
  const tools = new Map<string, ToolEntry>()
  const findTool = (id: string): ToolEntry | null => {
    const known = tools.get(id)
    if (known !== undefined) return known
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]
      if (e.kind === 'tool' && e.call.id === id) return e
    }
    return null
  }
  for (const event of events) {
    switch (event.type) {
      case 'user_message':
      case 'injected_user_message':
        entries.push({ kind: 'user', id: newId(), text: event.text })
        break
      case 'assistant_delta': {
        const last = entries[entries.length - 1]
        if (last?.kind === 'text') last.text += event.text
        else entries.push({ kind: 'text', id: newId(), text: event.text, open: false })
        break
      }
      case 'thought_delta': {
        const last = entries[entries.length - 1]
        if (last?.kind === 'thinking') last.text += event.text
        else entries.push({ kind: 'thinking', id: newId(), text: event.text, open: false })
        break
      }
      case 'tool_start': {
        const entry: ToolEntry = { kind: 'tool', id: newId(), call: event.call, partial: '', result: null, children: [] }
        tools.set(event.call.id, entry)
        if (event.call.parentToolCallId === null || !appendChildTool(entries, event.call.parentToolCallId, entry)) {
          entries.push(entry)
        }
        break
      }
      case 'tool_update': {
        const tool = findTool(event.id)
        if (tool !== null && tool.result === null) tool.partial = event.text
        break
      }
      case 'tool_end': {
        const tool = findTool(event.call.id)
        if (tool !== undefined && tool !== null) tool.result = event.result
        else {
          const entry: ToolEntry = { kind: 'tool', id: newId(), call: event.call, partial: '', result: event.result, children: [] }
          tools.set(event.call.id, entry)
          if (event.call.parentToolCallId === null || !appendChildTool(entries, event.call.parentToolCallId, entry)) {
            entries.push(entry)
          }
        }
        break
      }
      case 'notify':
        entries.push(
          event.isError
            ? { kind: 'error', id: newId(), text: event.message }
            : { kind: 'info', id: newId(), text: event.message }
        )
        break
      case 'compaction_start':
        entries.push({ kind: 'info', id: newId(), text: compactionBannerText(event.reason) })
        break
      case 'compaction_end':
        entries.push({
          kind: 'info',
          id: newId(),
          text: event.end.error ?? (event.end.aborted ? 'Compaction cancelled.' : compactionSummaryText(event.end))
        })
        break
      case 'turn_result':
        entries.push({ kind: 'result', id: newId(), usage: event.usage })
        break
      case 'turn_error':
        entries.push({ kind: 'error', id: newId(), text: event.message })
        break
      default:
        break
    }
  }
  return entries
}

/** Чистый переход по транслированному событию; дельты буферизуются отдельно. */
function reduceEvent(hostId: string, host: HostChat, event: UiEvent): HostChat {
  switch (event.type) {
    case 'assistant_delta':
      hostBuffers(hostId).pendingText += event.text
      return host
    case 'thought_delta':
      hostBuffers(hostId).pendingThought += event.text
      return host
    case 'turn_start': {
      const flushed = withFlushed(hostId, host)
      return { ...flushed, entries: closeOpenBlocks(flushed.entries), streaming: true }
    }
    case 'turn_end': {
      const flushed = withFlushed(hostId, host)
      ownEchoes.set(hostId, 0)
      return { ...flushed, entries: closeOpenBlocks(flushed.entries), streaming: false }
    }
    case 'assistant_message_start': {
      const flushed = withFlushed(hostId, host)
      return { ...flushed, entries: closeOpenBlocks(flushed.entries) }
    }
    case 'user_message': {
      const flushed = withFlushed(hostId, host)
      const echoes = ownEchoes.get(hostId) ?? 0
      if (echoes > 0) {
        ownEchoes.set(hostId, echoes - 1)
        return flushed
      }
      return { ...flushed, entries: [...flushed.entries, { kind: 'user', id: newId(), text: event.text }] }
    }
    case 'injected_user_message': {
      const flushed = withFlushed(hostId, host)
      return { ...flushed, entries: [...flushed.entries, { kind: 'user', id: newId(), text: event.text }] }
    }
    case 'tool_start': {
      const flushed = withFlushed(hostId, host)
      const entry: ToolEntry = { kind: 'tool', id: newId(), call: event.call, partial: '', result: null, children: [] }
      const parentId = event.call.parentToolCallId
      if (parentId !== null) {
        const entries = [...flushed.entries]
        if (appendChildTool(entries, parentId, entry)) return { ...flushed, entries }
      }
      return {
        ...flushed,
        entries: [...closeOpenBlocks(flushed.entries), entry]
      }
    }
    case 'tool_update': {
      const flushed = withFlushed(hostId, host)
      const entries = [...flushed.entries]
      mapToolEntry(entries, event.id, (e) => (e.result === null ? { ...e, partial: event.text } : e))
      return { ...flushed, entries }
    }
    case 'tool_end': {
      const flushed = withFlushed(hostId, host)
      const entries = [...flushed.entries]
      const found = mapToolEntry(entries, event.call.id, (e) => ({ ...e, result: event.result }))
      if (!found) entries.push({ kind: 'tool', id: newId(), call: event.call, partial: '', result: event.result, children: [] })
      return { ...flushed, entries }
    }
    case 'queue_update': {
      const flushed = withFlushed(hostId, host)
      return { ...flushed, queue: { steering: event.steering, followUp: event.followUp } }
    }
    case 'context_usage':
      return { ...host, contextUsage: { used: event.used, size: event.size } }
    case 'session_stats':
      return { ...host, usageTotals: event.tokens }
    case 'extension_status': {
      const statuses = { ...host.extensionStatuses }
      if (event.text === null) delete statuses[event.key]
      else statuses[event.key] = event.text
      return { ...host, extensionStatuses: statuses }
    }
    case 'widget': {
      const widgets = { ...host.widgets }
      if (event.lines === null) delete widgets[event.key]
      else widgets[event.key] = event.lines
      return { ...host, widgets }
    }
    case 'notify': {
      const flushed = withFlushed(hostId, host)
      return {
        ...flushed,
        entries: [
          ...flushed.entries,
          event.isError
            ? { kind: 'error', id: newId(), text: event.message }
            : { kind: 'info', id: newId(), text: event.message }
        ]
      }
    }
    case 'compaction_start': {
      const flushed = withFlushed(hostId, host)
      return { ...flushed, entries: [...flushed.entries, { kind: 'info', id: newId(), text: compactionBannerText(event.reason) }] }
    }
    case 'compaction_end': {
      const flushed = withFlushed(hostId, host)
      const text = event.end.error ?? (event.end.aborted ? 'Compaction cancelled.' : compactionSummaryText(event.end))
      return { ...flushed, entries: [...flushed.entries, { kind: 'info', id: newId(), text }] }
    }
    case 'turn_result': {
      const flushed = withFlushed(hostId, host)
      return { ...flushed, entries: [...flushed.entries, { kind: 'result', id: newId(), usage: event.usage }] }
    }
    case 'turn_error': {
      const flushed = withFlushed(hostId, host)
      return { ...flushed, entries: [...flushed.entries, { kind: 'error', id: newId(), text: event.message }] }
    }
    case 'dialog_open': {
      const flushed = withFlushed(hostId, host)
      return {
        ...flushed,
        entries: [...flushed.entries, { kind: 'dialog', id: newId(), dialogId: event.id, dialog: event.dialog, receipt: null }]
      }
    }
    case 'dialog_expired': {
      const flushed = withFlushed(hostId, host)
      return {
        ...flushed,
        entries: flushed.entries.map((e) =>
          e.kind === 'dialog' && e.dialogId === event.id && e.receipt === null ? { ...e, receipt: 'expired' } : e
        )
      }
    }
    case 'dialog_answered': {
      // Ответ с другой стороны (ПК ↔ телефон): закрыть карточку, если ещё открыта.
      const flushed = withFlushed(hostId, host)
      return {
        ...flushed,
        entries: flushed.entries.map((e) =>
          e.kind === 'dialog' && e.dialogId === event.id && e.receipt === null ? { ...e, receipt: 'answered' } : e
        )
      }
    }
    case 'session_name':
      return host
  }
}

export const useChatStore = create<ChatState>((set) => ({
  hosts: {},
  applyEvent: (message) => {
    const { hostId, event } = message
    const isDelta = event.type === 'assistant_delta' || event.type === 'thought_delta'
    set((state) => {
      const host = state.hosts[hostId] ?? emptyHostChat()
      const next = reduceEvent(hostId, host, event)
      return { hosts: { ...state.hosts, [hostId]: next } }
    })
    if (isDelta) {
      const b = hostBuffers(hostId)
      if (b.flushTimer === null) {
        b.flushTimer = setTimeout(() => {
          b.flushTimer = null
          set((state) => {
            const host = state.hosts[hostId]
            if (host === undefined) return state
            return { hosts: { ...state.hosts, [hostId]: withFlushed(hostId, host) } }
          })
        }, FLUSH_INTERVAL_MS)
      }
    }
  },
  applyStatus: (status) => {
    set((state) => {
      const host = state.hosts[status.hostId] ?? emptyHostChat()
      return { hosts: { ...state.hosts, [status.hostId]: { ...host, status } } }
    })
  },
  removeHost: (hostId) => {
    resetBuffers(hostId)
    buffers.delete(hostId)
    ownEchoes.delete(hostId)
    set((state) => {
      const hosts = { ...state.hosts }
      delete hosts[hostId]
      return { hosts }
    })
  },
  addUserMessage: (hostId, text) => {
    ownEchoes.set(hostId, (ownEchoes.get(hostId) ?? 0) + 1)
    set((state) => {
      const host = state.hosts[hostId] ?? emptyHostChat()
      const next: HostChat = { ...host, entries: [...host.entries, { kind: 'user', id: newId(), text }] }
      return { hosts: { ...state.hosts, [hostId]: next } }
    })
  },
  setDialogReceipt: (hostId, dialogId, receipt) =>
    set((state) => {
      const host = state.hosts[hostId]
      if (host === undefined) return state
      const next: HostChat = {
        ...host,
        entries: host.entries.map((e) =>
          e.kind === 'dialog' && e.dialogId === dialogId && e.receipt === null ? { ...e, receipt } : e
        )
      }
      return { hosts: { ...state.hosts, [hostId]: next } }
    }),
  toggleToolsHidden: (hostId) =>
    set((state) => {
      const host = state.hosts[hostId]
      if (host === undefined) return state
      return { hosts: { ...state.hosts, [hostId]: { ...host, toolsHidden: !host.toolsHidden } } }
    }),
  toggleMuted: (hostId) =>
    set((state) => {
      const host = state.hosts[hostId]
      if (host === undefined) return state
      return { hosts: { ...state.hosts, [hostId]: { ...host, muted: !host.muted } } }
    }),
  markUnread: (hostId) =>
    set((state) => {
      const host = state.hosts[hostId]
      if (host === undefined || host.unread) return state
      return { hosts: { ...state.hosts, [hostId]: { ...host, unread: true } } }
    }),
  markRead: (hostId) =>
    set((state) => {
      const host = state.hosts[hostId]
      if (host === undefined || !host.unread) return state
      return { hosts: { ...state.hosts, [hostId]: { ...host, unread: false } } }
    }),
  resetTranscript: (hostId) => {
    resetBuffers(hostId)
    set((state) => {
      const host = state.hosts[hostId]
      if (host === undefined) return state
      return {
        hosts: {
          ...state.hosts,
          [hostId]: {
            ...host,
            entries: [],
            streaming: false,
            queue: { steering: [], followUp: [] },
            contextUsage: null,
            usageTotals: null,
            extensionStatuses: {},
            widgets: {}
          }
        }
      }
    })
  }
}))

/** Чат активной сессии для селекторов. */
export function chatStoreSnapshot(): ChatState {
  return useChatStore.getState()
}
