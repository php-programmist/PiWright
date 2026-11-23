/** Переводит события `pi --mode rpc` (и сообщения из `get_messages` при восстановлении сессии)
 *  в вызовы StreamListener. Чистый класс без транспорта — тестируется на записанном потоке живого pi.
 *  Порт `core/PiEventTranslator.kt`. */
import type {
  CompactionEnd,
  ContextUsage,
  ToolCall,
  ToolResult,
  TurnSpeed,
  TurnUsage
} from '../../shared/agent-events'
import type { PiJsonObject } from '../../shared/protocol-types'

export interface StreamListener {
  onAssistantTextDelta(text: string): void
  onThoughtDelta(text: string): void
  onStreamSpeed(kind: 'thinking' | 'text', tps: number | null): void
  onInjectedUserMessage(text: string): void
  onUserMessage(text: string): void
  onQueueUpdate(steering: string[], followUp: string[]): void
  onToolStart(call: ToolCall): void
  onToolUpdate(id: string, partialText: string): void
  onToolEnd(call: ToolCall, result: ToolResult): void
  onContextUsageUpdate(usage: ContextUsage): void
  onSessionNameChanged(name: string | null): void
  onNotify(message: string, isError: boolean): void
  onCompactionStart(reason: string): void
  onCompactionEnd(end: CompactionEnd): void
  onResult(usage: TurnUsage): void
  onError(message: string): void
  onSubagentsActivity(kind: 'started' | 'completed' | 'workflow_started' | 'workflow_settled' | 'disposed', id: string | null): void
}

export function str(obj: PiJsonObject | null, key: string): string | null {
  const value = obj?.[key]
  return typeof value === 'string' ? value : null
}

export function obj(obj: PiJsonObject | null, key: string): PiJsonObject | null {
  const value = obj?.[key]
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as PiJsonObject) : null
}

export function array(obj: PiJsonObject | null, key: string): unknown[] {
  const value = obj?.[key]
  return Array.isArray(value) ? value : []
}

export function strings(obj: PiJsonObject | null, key: string): string[] {
  return array(obj, key).filter((v): v is string => typeof v === 'string')
}

export function bool(obj: PiJsonObject | null, key: string): boolean {
  return typeof obj?.[key] === 'boolean' ? (obj[key] as boolean) : false
}

export function long(obj: PiJsonObject | null, key: string): number {
  const value = obj?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Текст из `content`: строка как есть либо склейка `{type:"text"}`-блоков. */
export function contentText(holder: PiJsonObject | null): string {
  const content = holder?.['content']
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((b): b is PiJsonObject => b !== null && typeof b === 'object' && !Array.isArray(b))
    .filter((b) => b['type'] === 'text' && typeof b['text'] === 'string')
    .map((b) => b['text'] as string)
    .join('\n')
}

function toolResult(result: PiJsonObject | null, isError: boolean): ToolResult {
  return {
    text: contentText(result),
    isError,
    patch: str(obj(result, 'details'), 'patch')
  }
}

/** Окно обновления живого TPS: и первый замер, и троттлинг повторных. */
const SPEED_EMIT_INTERVAL_NANOS = 400 * 1e6

interface TurnAccumulator {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number | null
  lastContextTokens: number | null
  error: string | null
  ttftTotalNanos: number
  ttftCount: number
  generationNanos: number
  generationOutput: number
}

function freshTurn(): TurnAccumulator {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: null,
    lastContextTokens: null,
    error: null,
    ttftTotalNanos: 0,
    ttftCount: 0,
    generationNanos: 0,
    generationOutput: 0
  }
}

export class PiEventTranslator {
  /** Размер окна текущей модели — для процента заполнения; 0 — неизвестен. */
  contextWindow = 0

  private readonly toolCalls = new Map<string, ToolCall>()
  private turn: TurnAccumulator = freshTurn()
  private messageStartNanos: number | null = null
  private firstDeltaNanos: number | null = null
  /** Текущая серия дельт (thinking/text) для живого TPS; null — стрима нет. */
  private speedRun: { kind: 'thinking' | 'text'; startNanos: number; chars: number; lastEmitNanos: number } | null = null

  constructor(
    private readonly listener: StreamListener,
    private readonly nanoTime: () => number = () => performance.now() * 1e6
  ) {}

  onEvent(type: string, payload: PiJsonObject): void {
    if (type !== 'message_update') this.endSpeedRun()
    switch (type) {
      case 'message_start': {
        if (str(obj(payload, 'message'), 'role') === 'assistant') {
          this.messageStartNanos = this.nanoTime()
          this.firstDeltaNanos = null
        }
        return
      }
      case 'message_update': {
        const event = obj(payload, 'assistantMessageEvent')
        if (event === null) return
        const kind = str(event, 'type')
        if (kind !== null && kind.endsWith('_delta')) this.markFirstDelta()
        if (kind !== 'thinking_delta' && kind !== 'text_delta') {
          this.endSpeedRun()
          return
        }
        const delta = str(event, 'delta')
        if (delta === null) return
        if (kind === 'text_delta') {
          this.listener.onAssistantTextDelta(delta)
          this.feedSpeed('text', delta)
        }
        if (kind === 'thinking_delta') {
          this.listener.onThoughtDelta(delta)
          this.feedSpeed('thinking', delta)
        }
        return
      }
      case 'message_end': {
        const message = obj(payload, 'message')
        if (message !== null) this.onMessageEnd(message)
        return
      }
      case 'tool_execution_start': {
        const id = str(payload, 'toolCallId')
        if (id === null) return
        const call: ToolCall = {
          id,
          name: str(payload, 'toolName') ?? 'tool',
          args: obj(payload, 'args') ?? {},
          parentToolCallId: str(payload, 'parentToolCallId')
        }
        this.toolCalls.set(call.id, call)
        this.listener.onToolStart(call)
        return
      }
      case 'tool_execution_update': {
        const id = str(payload, 'toolCallId')
        if (id === null) return
        this.listener.onToolUpdate(id, contentText(obj(payload, 'partialResult')))
        return
      }
      case 'tool_execution_end': {
        const id = str(payload, 'toolCallId')
        if (id === null) return
        const call = this.toolCalls.get(id) ?? {
          id,
          name: str(payload, 'toolName') ?? 'tool',
          args: {},
          parentToolCallId: str(payload, 'parentToolCallId')
        }
        this.toolCalls.delete(id)
        this.listener.onToolEnd(call, toolResult(obj(payload, 'result'), bool(payload, 'isError')))
        return
      }
      case 'queue_update':
        this.listener.onQueueUpdate(strings(payload, 'steering'), strings(payload, 'followUp'))
        return
      case 'session_info_changed':
        this.listener.onSessionNameChanged(str(payload, 'name'))
        return
      case 'extension_error':
        this.listener.onNotify(str(payload, 'error') ?? 'Extension error', true)
        return
      case 'compaction_start':
        this.listener.onCompactionStart(str(payload, 'reason') ?? 'manual')
        return
      case 'compaction_end':
        this.onCompactionEnd(payload)
        return
      case 'entry_appended': {
        // Мост subagent-bridge пересылает события pi-subagents как custom-entry:
        // шина pi.events в RPC-stdout не попадает, а entry_appended — попадает.
        const entry = obj(payload, 'entry')
        if (str(entry, 'customType') !== 'piwright:subagents') return
        const data = obj(entry, 'data')
        const kind = str(data, 'kind')
        if (kind === 'started' || kind === 'completed' || kind === 'workflow_started' || kind === 'workflow_settled' || kind === 'disposed') {
          this.listener.onSubagentsActivity(kind, str(data, 'id'))
        }
        return
      }
      case 'subagents:created':
      case 'subagents:started':
        this.listener.onSubagentsActivity('started', str(payload, 'id'))
        return
      case 'subagents:completed':
      case 'subagents:failed':
        this.listener.onSubagentsActivity('completed', str(payload, 'id'))
        return
      case 'subagents:workflow_started':
        this.listener.onSubagentsActivity('workflow_started', str(payload, 'id'))
        return
      case 'subagents:workflow_settled':
        this.listener.onSubagentsActivity('workflow_settled', str(payload, 'id'))
        return
      case 'subagents:disposed':
        this.listener.onSubagentsActivity('disposed', null)
        return
      case 'agent_settled':
        this.onSettled()
        return
    }
  }

  /** Живой TPS серии дельт: токены ≈ chars/4, окно — от первой дельты серии; эмиссия раз в 400 мс.
   *  Смена kind (thinking↔text) и конец серии — эмиссия null, чтобы UI скрыл устаревшее значение. */
  private feedSpeed(kind: 'thinking' | 'text', delta: string): void {
    const now = this.nanoTime()
    if (this.speedRun === null || this.speedRun.kind !== kind) {
      if (this.speedRun !== null) this.listener.onStreamSpeed(this.speedRun.kind, null)
      this.speedRun = { kind, startNanos: now, chars: 0, lastEmitNanos: 0 }
    }
    this.speedRun.chars += delta.length
    const elapsed = now - this.speedRun.startNanos
    if (elapsed < SPEED_EMIT_INTERVAL_NANOS) return
    if (now - this.speedRun.lastEmitNanos < SPEED_EMIT_INTERVAL_NANOS) return
    this.speedRun.lastEmitNanos = now
    this.listener.onStreamSpeed(kind, this.speedRun.chars / 4 / (elapsed / 1e9))
  }

  private endSpeedRun(): void {
    if (this.speedRun === null) return
    const kind = this.speedRun.kind
    this.speedRun = null
    this.listener.onStreamSpeed(kind, null)
  }

  private markFirstDelta(): void {
    if (this.messageStartNanos === null || this.firstDeltaNanos !== null) return
    const now = this.nanoTime()
    this.firstDeltaNanos = now
    this.turn.ttftTotalNanos += now - this.messageStartNanos
    this.turn.ttftCount++
  }

  private turnSpeed(): TurnSpeed | null {
    const turn = this.turn
    const tps =
      turn.generationNanos > 0 && turn.generationOutput > 0
        ? (turn.generationOutput * 1e9) / turn.generationNanos
        : null
    if (turn.ttftCount === 0 && tps === null) return null
    const ttftMs = turn.ttftCount > 0 ? turn.ttftTotalNanos / turn.ttftCount / 1e6 : null
    return { ttftMs, tokensPerSecond: tps }
  }

  private onMessageEnd(message: PiJsonObject): void {
    const role = str(message, 'role')
    if (role === 'user') {
      this.listener.onUserMessage(contentText(message))
      return
    }
    if (role !== 'assistant') return
    const usage = obj(message, 'usage')
    if (this.firstDeltaNanos !== null) {
      this.turn.generationNanos += this.nanoTime() - this.firstDeltaNanos
      this.turn.generationOutput += usage !== null ? long(usage, 'output') : 0
    }
    this.messageStartNanos = null
    this.firstDeltaNanos = null
    if (usage !== null) {
      this.turn.input += long(usage, 'input')
      this.turn.output += long(usage, 'output')
      this.turn.cacheRead += long(usage, 'cacheRead')
      this.turn.cacheWrite += long(usage, 'cacheWrite')
      if (usage['reasoning'] != null) this.turn.reasoning = (this.turn.reasoning ?? 0) + long(usage, 'reasoning')
      const total = long(usage, 'totalTokens')
      if (total > 0) {
        this.turn.lastContextTokens = total
        if (this.contextWindow > 0) {
          this.listener.onContextUsageUpdate({ used: total, size: this.contextWindow })
        }
      }
    }
    if (str(message, 'stopReason') === 'error') {
      this.turn.error = str(message, 'errorMessage') ?? 'Model request failed.'
    }
  }

  /** Успешная компакция сбрасывает заполнение контекста до оценки pi (`estimatedTokensAfter`). */
  private onCompactionEnd(payload: PiJsonObject): void {
    const result = obj(payload, 'result')
    const after = long(result, 'estimatedTokensAfter')
    const tokensAfter = after > 0 ? after : null
    if (tokensAfter !== null) {
      this.turn.lastContextTokens = tokensAfter
      if (this.contextWindow > 0) {
        this.listener.onContextUsageUpdate({ used: tokensAfter, size: this.contextWindow })
      }
    }
    this.listener.onCompactionEnd({
      reason: str(payload, 'reason') ?? 'manual',
      tokensBefore: long(result, 'tokensBefore') > 0 ? long(result, 'tokensBefore') : null,
      tokensAfter,
      aborted: bool(payload, 'aborted'),
      error: str(payload, 'errorMessage'),
      willRetry: bool(payload, 'willRetry')
    })
  }

  private onSettled(): void {
    const turn = this.turn
    if (turn.error !== null) this.listener.onError(turn.error)
    else {
      this.listener.onResult({
        inputTokens: turn.input,
        outputTokens: turn.output,
        cacheReadTokens: turn.cacheRead,
        cacheWriteTokens: turn.cacheWrite,
        reasoningTokens: turn.reasoning,
        contextTokens: turn.lastContextTokens,
        speed: this.turnSpeed()
      })
    }
    this.turn = freshTurn()
  }

  /** Реплей истории из `get_messages`: теми же вызовами listener, что и живой поток.
   *  Попутно восстанавливает метаданные хода (длительность, токены, tok/s) из таймстампов
   *  и `usage`/`durationMs` сообщений — pi пишет их в JSONL каждой сессии. */
  replay(messages: unknown[]): void {
    const calls = new Map<string, ToolCall>()
    // Аккумулятор текущего хода реплея; граница — user-промпт после завершившего ход ответа
    // (stopReason toolUse = steering, продолжает текущий ход).
    let turnStartTs: number | null = null
    let turnEndTs: number | null = null
    let turnActive = false
    let input = 0
    let output = 0
    let cacheRead = 0
    let cacheWrite = 0
    let reasoning: number | null = null
    let lastContextTokens: number | null = null
    let generationMs = 0
    let lastStopReason: string | null = null
    const flushTurn = (): void => {
      if (!turnActive) return
      const durationMs = turnStartTs !== null && turnEndTs !== null && turnEndTs > turnStartTs ? turnEndTs - turnStartTs : null
      if (input > 0 || output > 0 || durationMs !== null) {
        const tps = generationMs > 0 && output > 0 ? (output * 1000) / generationMs : null
        this.listener.onResult({
          inputTokens: input,
          outputTokens: output,
          cacheReadTokens: cacheRead,
          cacheWriteTokens: cacheWrite,
          reasoningTokens: reasoning,
          contextTokens: lastContextTokens,
          speed: tps !== null ? { ttftMs: null, tokensPerSecond: tps } : null,
          durationMs
        })
      }
      turnActive = false
      turnStartTs = null
      turnEndTs = null
      input = 0
      output = 0
      cacheRead = 0
      cacheWrite = 0
      reasoning = null
      lastContextTokens = null
      generationMs = 0
      lastStopReason = null
    }
    const tsOf = (message: PiJsonObject): number | null =>
      typeof message['timestamp'] === 'number' && Number.isFinite(message['timestamp']) ? message['timestamp'] : null
    for (const element of messages) {
      if (element === null || typeof element !== 'object' || Array.isArray(element)) continue
      const message = element as PiJsonObject
      const role = str(message, 'role')
      if (role === 'user') {
        const text = contentText(message)
        if (text.trim().length > 0) {
          if (lastStopReason === null || lastStopReason === 'stop' || lastStopReason === 'length' || lastStopReason === 'error' || lastStopReason === 'aborted') {
            flushTurn()
          }
          turnActive = true
          const ts = tsOf(message)
          if (turnStartTs === null) turnStartTs = ts
          this.listener.onInjectedUserMessage(text)
        }
        continue
      }
      if (role === 'assistant') {
        const ts = tsOf(message)
        const duration = typeof message['durationMs'] === 'number' && Number.isFinite(message['durationMs']) ? message['durationMs'] : 0
        if (turnActive) {
          const usage = obj(message, 'usage')
          input += usage !== null ? long(usage, 'input') : 0
          output += usage !== null ? long(usage, 'output') : 0
          cacheRead += usage !== null ? long(usage, 'cacheRead') : 0
          cacheWrite += usage !== null ? long(usage, 'cacheWrite') : 0
          if (usage !== null && usage['reasoning'] != null) reasoning = (reasoning ?? 0) + long(usage, 'reasoning')
          const total = usage !== null ? long(usage, 'totalTokens') : 0
          if (total > 0) lastContextTokens = total
          generationMs += duration
          if (ts !== null) turnEndTs = ts + duration
        }
        lastStopReason = str(message, 'stopReason')
        for (const block of array(message, 'content')) {
          if (block === null || typeof block !== 'object' || Array.isArray(block)) continue
          const b = block as PiJsonObject
          const kind = str(b, 'type')
          if (kind === 'thinking') {
            const thinking = str(b, 'thinking')
            if (thinking !== null && thinking.trim().length > 0) this.listener.onThoughtDelta(thinking)
          } else if (kind === 'text') {
            const text = str(b, 'text')
            if (text !== null && text.length > 0) this.listener.onAssistantTextDelta(text)
          } else if (kind === 'toolCall') {
            const id = str(b, 'id')
            if (id === null) continue
            const call: ToolCall = { id, name: str(b, 'name') ?? 'tool', args: obj(b, 'arguments') ?? {}, parentToolCallId: null }
            calls.set(call.id, call)
            this.listener.onToolStart(call)
          }
        }
        continue
      }
      if (role === 'toolResult') {
        if (turnActive) {
          const ts = tsOf(message)
          const duration = typeof message['durationMs'] === 'number' && Number.isFinite(message['durationMs']) ? message['durationMs'] : 0
          if (ts !== null) turnEndTs = ts + duration
        }
        const id = str(message, 'toolCallId')
        if (id === null) continue
        const call = calls.get(id) ?? { id, name: str(message, 'toolName') ?? 'tool', args: {}, parentToolCallId: null }
        calls.delete(id)
        this.listener.onToolEnd(call, toolResult(message, bool(message, 'isError')))
        continue
      }
      if (role === 'compactionSummary') {
        const tokensBefore = long(message, 'tokensBefore')
        this.listener.onCompactionEnd({
          reason: 'manual',
          tokensBefore: tokensBefore > 0 ? tokensBefore : null,
          tokensAfter: null,
          aborted: false,
          error: null,
          willRetry: false
        })
      }
    }
    flushTurn()
  }
}
