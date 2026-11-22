/** Протокол-независимый контракт транспорт → UI. Порт `core/AgentEvents.kt` (нужное для фазы 2). */
import type { AskDialog } from './ask-questions'

/** Вызов инструмента pi: `tool_execution_start` (или `toolCall` в истории).
 *  `parentToolCallId` — вызов сделан другим инструментом (nested/субагент). */
export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  parentToolCallId: string | null
}

/** Итог инструмента: текст из `result.content[]`, флаг ошибки и unified-патч (`details.patch`, у `edit`). */
export interface ToolResult {
  text: string
  isError: boolean
  patch: string | null
}

/** Скорость модели за ход: ttfb — среднее по assistant-сообщениям до первой дельты, мс. */
export interface TurnSpeed {
  ttfbMs: number
  tokensPerSecond: number | null
}

/** Токены одного хода. reasoningTokens — null, когда провайдер его не сообщает. */
export interface TurnUsage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number | null
  contextTokens: number | null
  speed: TurnSpeed | null
}

/** Заполнение контекстного окна: токены последнего ответа модели / размер окна. */
export interface ContextUsage {
  used: number
  size: number
}

/** Суммарные токены сессии из `get_session_stats` (старт хоста и после каждого хода). */
export interface SessionTokens {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
}

/** Доля чтения промпта из кэша; null — промпт пуст. Порт `cacheHitOf`. */
export function cacheHitOf(inputTokens: number, cacheReadTokens: number, cacheWriteTokens: number): number | null {
  const prompt = inputTokens + cacheReadTokens + cacheWriteTokens
  if (prompt <= 0) return null
  return Math.round((cacheReadTokens * 100) / prompt)
}

/** Цвет процента заполнения: 11 бакетов по 10%, hue 120° (зелёный) → 0° (красный).
 *  Порт `PercentColor.kt` (HSB 0.9/0.7 → RGB). */
export function percentColor(p: number): string {
  const bucket = Math.min(10, Math.max(0, Math.floor(p / 10)))
  const hue = (120 * (1 - bucket / 10)) / 360
  const s = 0.9
  const v = 0.7
  const c = v * s
  const sector = hue * 6
  const x = c * (1 - Math.abs((sector % 2) - 1))
  let r = 0
  let g = 0
  let b = 0
  if (sector < 1) [r, g, b] = [c, x, 0]
  else if (sector < 2) [r, g, b] = [x, c, 0]
  else if (sector < 3) [r, g, b] = [0, c, x]
  else if (sector < 4) [r, g, b] = [0, x, c]
  else if (sector < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const m = v - c
  const to = (f: number): string => Math.round((f + m) * 255)
    .toString(16)
    .padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

/** Состояние петли PiWright (чекбокс «Петля»): remaining — сколько итераций ещё можно заспавнить. */
export type LoopStopReason = 'agent' | 'exit' | 'user' | 'max' | 'short-circuit' | 'error'

export interface LoopInfo {
  active: boolean
  remaining: number
  reason: LoopStopReason | null
}

/** Итог компакции (`compaction_end`). reason — `manual` / `threshold` / `overflow`. */
export interface CompactionEnd {
  reason: string
  tokensBefore: number | null
  tokensAfter: number | null
  aborted: boolean
  error: string | null
  willRetry: boolean
}

/** Текст баннера на время компакции. */
export function compactionBannerText(reason: string): string {
  if (reason === 'threshold') return 'Compacting context (near the limit)…'
  if (reason === 'overflow') return 'Compacting context (overflow)…'
  return 'Compacting context…'
}

/** Итог успешной компакции для ленты. */
export function compactionSummaryText(end: CompactionEnd): string {
  const before = (end.tokensBefore ?? 0).toLocaleString('en-US')
  const after = end.tokensAfter !== null ? ` → ~${end.tokensAfter.toLocaleString('en-US')}` : ''
  const retry = end.willRetry ? ', retrying the request' : ''
  return `Context compacted: ${before}${after} tokens${retry}`
}

/** Диалог расширения pi (`extension_ui_request`), ждущий ответа пользователя. */
export type ExtensionDialog =
  | { kind: 'confirm'; title: string; message: string | null; timeoutMs: number | null }
  | { kind: 'select'; title: string; body: string | null; options: string[]; timeoutMs: number | null }
  | { kind: 'input'; title: string; placeholder: string | null; timeoutMs: number | null }
  | { kind: 'editor'; title: string; prefill: string | null; timeoutMs: number | null }
  | AskDialog

/** Ответ на диалог: confirmed у confirm, value у остальных; cancelled — закрыт без выбора. */
export type DialogAnswer =
  | { kind: 'confirmed'; confirmed: boolean }
  | { kind: 'value'; value: string }
  | { kind: 'cancelled' }

/** События транслятора (`PiEventTranslator`) — то, что renderer получает по `pi:event`. */
export type UiEvent =
  | { type: 'user_message'; text: string }
  | { type: 'injected_user_message'; text: string }
  | { type: 'assistant_delta'; text: string }
  | { type: 'thought_delta'; text: string }
  | { type: 'tool_start'; call: ToolCall }
  | { type: 'tool_update'; id: string; text: string }
  | { type: 'tool_end'; call: ToolCall; result: ToolResult }
  | { type: 'queue_update'; steering: string[]; followUp: string[] }
  | { type: 'context_usage'; used: number; size: number }
  | { type: 'session_stats'; tokens: SessionTokens }
  | { type: 'extension_status'; key: string; text: string | null }
  | { type: 'widget'; key: string; lines: string[] | null }
  | { type: 'session_name'; name: string | null }
  | { type: 'notify'; message: string; isError: boolean }
  | { type: 'compaction_start'; reason: string }
  | { type: 'compaction_end'; end: CompactionEnd }
  | { type: 'turn_result'; usage: TurnUsage }
  | { type: 'turn_error'; message: string }
  | { type: 'turn_start'; external?: boolean }
  | { type: 'turn_end'; check?: boolean }
  | { type: 'subagents_activity'; kind: 'started' | 'completed' | 'workflow_started' | 'workflow_settled' | 'disposed'; id: string | null }
  | { type: 'loop_state'; info: LoopInfo; previousHostId: string | null }
  | { type: 'assistant_message_start' }
  /** Пачка событий реплея: длинная история отдаётся за один IPC вместо сотен. */
  | { type: 'replay_batch'; events: UiEvent[] }
  | { type: 'dialog_open'; id: string; dialog: ExtensionDialog }
  | { type: 'dialog_expired'; id: string }
  | { type: 'dialog_answered'; id: string; by: 'pc' | 'phone' }
