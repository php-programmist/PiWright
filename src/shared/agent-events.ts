/** Протокол-независимый контракт транспорт → UI. Порт `core/AgentEvents.kt` (нужное для фазы 2). */
import type { AskDialog } from './ask-questions'

/** Вызов инструмента pi: `tool_execution_start` (или `toolCall` в истории). */
export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
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
  | { type: 'session_name'; name: string | null }
  | { type: 'notify'; message: string; isError: boolean }
  | { type: 'compaction_start'; reason: string }
  | { type: 'compaction_end'; end: CompactionEnd }
  | { type: 'turn_result'; usage: TurnUsage }
  | { type: 'turn_error'; message: string }
  | { type: 'turn_start' }
  | { type: 'turn_end' }
  | { type: 'assistant_message_start' }
  | { type: 'dialog_open'; id: string; dialog: ExtensionDialog }
  | { type: 'dialog_expired'; id: string }
