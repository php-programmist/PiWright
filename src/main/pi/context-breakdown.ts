/** Оценка разбивки токенов контекста по сообщениям сессии (`get_messages`).
 *  Эвристика chars/4 — та же, что в pi (core/compaction estimateTokens).
 *  Системный промпт и схемы инструментов pi по RPC не отдаёт — они попадают
 *  в остаток `systemAndTools` = contextTokens − сумма оценок сообщений. */
import type { ContextBreakdownData } from '../../shared/ipc-contracts'
import type { PiJsonObject } from '../../shared/protocol-types'
import { array, long, obj, str } from './event-translator'

function textAndImageChars(content: unknown): number {
  if (typeof content === 'string') return content.length
  if (!Array.isArray(content)) return 0
  let chars = 0
  for (const block of content) {
    if (block === null || typeof block !== 'object' || Array.isArray(block)) continue
    const b = block as PiJsonObject
    if (typeof b['text'] === 'string') chars += (b['text'] as string).length
    // Картинка считается фиксированно: pi не токенизирует изображения в оценке.
    if (b['type'] === 'image') chars += 1600
  }
  return chars
}

/** Оценка токенов одного сообщения (chars/4, conservative). */
function estimateMessageTokens(message: PiJsonObject): { tokens: number; toolCallTokens: number } {
  const role = str(message, 'role')
  let chars = 0
  let toolCallChars = 0
  switch (role) {
    case 'assistant': {
      const content = array(message, 'content')
      for (const block of content) {
        if (block === null || typeof block !== 'object' || Array.isArray(block)) continue
        const b = block as PiJsonObject
        if (b['type'] === 'text' && typeof b['text'] === 'string') chars += b['text'].length
        else if (b['type'] === 'thinking' && typeof b['thinking'] === 'string') chars += b['thinking'].length
        else if (b['type'] === 'toolCall') {
          toolCallChars += str(b, 'name')?.length ?? 0
          toolCallChars += JSON.stringify(b['arguments'] ?? {}).length
        }
      }
      break
    }
    case 'bashExecution': {
      const m = message
      chars += (typeof m['command'] === 'string' ? m['command'].length : 0) + (typeof m['output'] === 'string' ? m['output'].length : 0)
      break
    }
    case 'branchSummary':
    case 'compactionSummary': {
      chars += typeof message['summary'] === 'string' ? (message['summary'] as string).length : 0
      break
    }
    default:
      chars = textAndImageChars(message['content'])
  }
  const toolCallTokens = Math.ceil(toolCallChars / 4)
  const tokens = Math.ceil((chars + toolCallChars) / 4)
  return { tokens, toolCallTokens }
}

/** Разбивка по массиву сообщений из ответа `get_messages`. */
export function estimateContextBreakdown(messages: unknown[]): ContextBreakdownData {
  const breakdown: ContextBreakdownData = {
    contextTokens: null,
    userMessages: 0,
    assistantText: 0,
    assistantToolCalls: 0,
    toolResults: 0,
    other: 0,
    systemAndTools: 0
  }
  let messageTokens = 0
  for (const raw of messages) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
    const message = raw as PiJsonObject
    const role = str(message, 'role')
    const { tokens, toolCallTokens } = estimateMessageTokens(message)
    messageTokens += tokens
    switch (role) {
      case 'user':
        breakdown.userMessages += tokens
        break
      case 'assistant':
        breakdown.assistantToolCalls += toolCallTokens
        breakdown.assistantText += tokens - toolCallTokens
        break
      case 'toolResult':
        breakdown.toolResults += tokens
        break
      case 'system':
      case 'bashExecution':
      case 'custom':
      case 'branchSummary':
      case 'compactionSummary':
        breakdown.other += tokens
        break
    }
    if (role === 'assistant') {
      const usage = obj(message, 'usage')
      const total = long(usage, 'totalTokens')
      if (total > 0) breakdown.contextTokens = total
    }
  }
  breakdown.systemAndTools =
    breakdown.contextTokens !== null ? Math.max(0, breakdown.contextTokens - messageTokens) : 0
  return breakdown
}
