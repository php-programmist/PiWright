import { create } from 'zustand'
import { compactionBannerText, compactionSummaryText } from '../../../shared/agent-events'
import type { ExtensionDialog, ToolCall, ToolResult, TurnUsage, UiEvent } from '../../../shared/agent-events'
import type { PiStatus, Settings } from '../../../shared/ipc-contracts'

export type Entry =
  | { kind: 'user'; id: number; text: string }
  | { kind: 'text'; id: number; text: string; open: boolean }
  | { kind: 'thinking'; id: number; text: string; open: boolean }
  | { kind: 'tool'; id: number; call: ToolCall; partial: string; result: ToolResult | null }
  | { kind: 'dialog'; id: number; dialogId: string; dialog: ExtensionDialog; receipt: string | null }
  | { kind: 'info'; id: number; text: string }
  | { kind: 'error'; id: number; text: string }
  | { kind: 'result'; id: number; usage: TurnUsage }

export interface QueueState {
  steering: string[]
  followUp: string[]
}

interface ChatState {
  status: PiStatus
  settings: Settings | null
  entries: Entry[]
  streaming: boolean
  queue: QueueState
  contextUsage: { used: number; size: number } | null
  applyEvent: (event: UiEvent) => void
  setStatus: (status: PiStatus) => void
  setSettings: (settings: Settings) => void
  addUserMessage: (text: string) => void
  setDialogReceipt: (dialogId: string, receipt: string) => void
  resetTranscript: () => void
}

/** Дельты копятся в буфере и попадают в state раз в ~150 мс — markdown не перерисовывается на каждый кадр. */
const FLUSH_INTERVAL_MS = 150

let nextEntryId = 1
let pendingText = ''
let pendingThought = ''
let flushTimer: ReturnType<typeof setTimeout> | null = null
/** Сколько только что отправленных сообщений ещё не вернулось эхом (`user_message`) —
 *  их уже показали в ленте. Остальные эхо — доставки из очереди, их рисуем при доставке. */
let ownEchoes = 0

function newId(): number {
  return nextEntryId++
}

function resetBuffers(): void {
  pendingText = ''
  pendingThought = ''
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
}

/** Прикладывает накопленные дельты: текст/thinking дописывают открытую запись или открывают новую. */
function withFlushed(state: ChatState): ChatState {
  if (pendingText.length === 0 && pendingThought.length === 0) return state
  const entries = [...state.entries]
  if (pendingThought.length > 0) {
    const last = entries[entries.length - 1]
    if (last?.kind === 'thinking' && last.open) {
      entries[entries.length - 1] = { ...last, text: last.text + pendingThought }
    } else {
      entries.push({ kind: 'thinking', id: newId(), text: pendingThought, open: true })
    }
    pendingThought = ''
  }
  if (pendingText.length > 0) {
    const last = entries[entries.length - 1]
    if (last?.kind === 'text' && last.open) {
      entries[entries.length - 1] = { ...last, text: last.text + pendingText }
    } else {
      entries.push({ kind: 'text', id: newId(), text: pendingText, open: true })
    }
    pendingText = ''
  }
  return { ...state, entries }
}

function closeOpenBlocks(entries: Entry[]): Entry[] {
  return entries.map((e) =>
    (e.kind === 'text' || e.kind === 'thinking') && e.open ? { ...e, open: false } : e
  )
}

/** Чистый переход по транслированному событию; дельты буферизуются отдельно. */
function reduceEvent(state: ChatState, event: UiEvent): ChatState {
  switch (event.type) {
    case 'assistant_delta':
      pendingText += event.text
      return state
    case 'thought_delta':
      pendingThought += event.text
      return state
    case 'turn_start': {
      const flushed = withFlushed(state)
      return { ...flushed, entries: closeOpenBlocks(flushed.entries), streaming: true }
    }
    case 'turn_end': {
      const flushed = withFlushed(state)
      ownEchoes = 0
      return { ...flushed, entries: closeOpenBlocks(flushed.entries), streaming: false }
    }
    case 'assistant_message_start': {
      const flushed = withFlushed(state)
      return { ...flushed, entries: closeOpenBlocks(flushed.entries) }
    }
    case 'user_message': {
      const flushed = withFlushed(state)
      if (ownEchoes > 0) {
        ownEchoes--
        return flushed
      }
      return { ...flushed, entries: [...flushed.entries, { kind: 'user', id: newId(), text: event.text }] }
    }
    case 'injected_user_message': {
      const flushed = withFlushed(state)
      return { ...flushed, entries: [...flushed.entries, { kind: 'user', id: newId(), text: event.text }] }
    }
    case 'tool_start': {
      const flushed = withFlushed(state)
      return {
        ...flushed,
        entries: [...closeOpenBlocks(flushed.entries), { kind: 'tool', id: newId(), call: event.call, partial: '', result: null }]
      }
    }
    case 'tool_update': {
      const flushed = withFlushed(state)
      const entries = [...flushed.entries]
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i]
        if (e.kind === 'tool' && e.call.id === event.id && e.result === null) {
          entries[i] = { ...e, partial: event.text }
          break
        }
      }
      return { ...flushed, entries }
    }
    case 'tool_end': {
      const flushed = withFlushed(state)
      const entries = [...flushed.entries]
      let found = false
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i]
        if (e.kind === 'tool' && e.call.id === event.call.id && e.result === null) {
          entries[i] = { ...e, result: event.result }
          found = true
          break
        }
      }
      if (!found) entries.push({ kind: 'tool', id: newId(), call: event.call, partial: '', result: event.result })
      return { ...flushed, entries }
    }
    case 'queue_update': {
      const flushed = withFlushed(state)
      return { ...flushed, queue: { steering: event.steering, followUp: event.followUp } }
    }
    case 'context_usage':
      return { ...state, contextUsage: { used: event.used, size: event.size } }
    case 'notify': {
      const flushed = withFlushed(state)
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
      const flushed = withFlushed(state)
      return { ...flushed, entries: [...flushed.entries, { kind: 'info', id: newId(), text: compactionBannerText(event.reason) }] }
    }
    case 'compaction_end': {
      const flushed = withFlushed(state)
      const text = event.end.error ?? (event.end.aborted ? 'Compaction cancelled.' : compactionSummaryText(event.end))
      return { ...flushed, entries: [...flushed.entries, { kind: 'info', id: newId(), text }] }
    }
    case 'turn_result': {
      const flushed = withFlushed(state)
      return { ...flushed, entries: [...flushed.entries, { kind: 'result', id: newId(), usage: event.usage }] }
    }
    case 'turn_error': {
      const flushed = withFlushed(state)
      return { ...flushed, entries: [...flushed.entries, { kind: 'error', id: newId(), text: event.message }] }
    }
    case 'dialog_open': {
      const flushed = withFlushed(state)
      return {
        ...flushed,
        entries: [...flushed.entries, { kind: 'dialog', id: newId(), dialogId: event.id, dialog: event.dialog, receipt: null }]
      }
    }
    case 'dialog_expired': {
      const flushed = withFlushed(state)
      return {
        ...flushed,
        entries: flushed.entries.map((e) =>
          e.kind === 'dialog' && e.dialogId === event.id && e.receipt === null ? { ...e, receipt: 'expired' } : e
        )
      }
    }
    case 'session_name':
      return state
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  status: {
    state: 'idle',
    backend: null,
    model: null,
    sessionId: null,
    sessionFile: null,
    error: null,
    models: [],
    thinkingLevels: [],
    thinkingLevel: null
  },
  settings: null,
  entries: [],
  streaming: false,
  queue: { steering: [], followUp: [] },
  contextUsage: null,
  applyEvent: (event) => {
    if (event.type === 'assistant_delta' || event.type === 'thought_delta') {
      set(reduceEvent(get(), event))
      if (flushTimer === null) {
        flushTimer = setTimeout(() => {
          flushTimer = null
          set(withFlushed(get()))
        }, FLUSH_INTERVAL_MS)
      }
      return
    }
    set(reduceEvent(get(), event))
  },
  setStatus: (status) => set({ status }),
  setSettings: (settings) => set({ settings }),
  addUserMessage: (text) => {
    ownEchoes++
    set((state) => ({ entries: [...state.entries, { kind: 'user', id: newId(), text }] }))
  },
  setDialogReceipt: (dialogId, receipt) =>
    set((state) => ({
      entries: state.entries.map((e) =>
        e.kind === 'dialog' && e.dialogId === dialogId && e.receipt === null ? { ...e, receipt } : e
      )
    })),
  resetTranscript: () => {
    resetBuffers()
    ownEchoes = 0
    set(() => ({ entries: [], streaming: false, queue: { steering: [], followUp: [] }, contextUsage: null }))
  }
}))
