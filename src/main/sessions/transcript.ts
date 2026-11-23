/** Транскрипт исторической сессии без запуска pi: строки `type:"message"` из .jsonl
 *  прогоняются через реплей `PiEventTranslator` — те же UiEvent-ы, что и у живой сессии. */
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import type { UiEvent } from '../../shared/agent-events'
import type { PiJsonObject } from '../../shared/protocol-types'
import { PiEventTranslator } from '../pi/event-translator'

/** Реплей сообщений `get_messages`/JSONL в список UiEvent-ов (чистая функция). */
export function replaySessionEvents(messages: unknown[]): UiEvent[] {
  const events: UiEvent[] = []
  const translator = new PiEventTranslator({
    onAssistantTextDelta: (text) => events.push({ type: 'assistant_delta', text }),
    onThoughtDelta: (text) => events.push({ type: 'thought_delta', text }),
    onStreamSpeed: () => {},
    onInjectedUserMessage: (text) => events.push({ type: 'injected_user_message', text }),
    onUserMessage: (text) => events.push({ type: 'user_message', text }),
    onQueueUpdate: () => {},
    onToolStart: (call) => events.push({ type: 'tool_start', call }),
    onToolUpdate: (id, text) => events.push({ type: 'tool_update', id, text }),
    onToolEnd: (call, result) => events.push({ type: 'tool_end', call, result }),
    onContextUsageUpdate: () => {},
    onSessionNameChanged: () => {},
    onNotify: (message, isError) => events.push({ type: 'notify', message, isError }),
    onCompactionStart: () => {},
    onCompactionEnd: (end) => events.push({ type: 'compaction_end', end }),
    onResult: (usage) => events.push({ type: 'turn_result', usage }),
    onError: (message) => events.push({ type: 'turn_error', message }),
    onSubagentsActivity: () => {}
  })
  translator.replay(messages)
  return events
}

/** Сообщения сессии из .jsonl: значения `message` строк `type:"message"` по порядку. */
export async function readSessionMessages(filePath: string): Promise<unknown[]> {
  const stream = createReadStream(filePath, { encoding: 'utf8' })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })
  const messages: unknown[] = []
  try {
    for await (const line of lines) {
      if (!line.includes('"type":"message"')) continue
      let parsed: unknown
      try {
        parsed = JSON.parse(line)
      } catch {
        continue
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) continue
      const record = parsed as PiJsonObject
      if (record['type'] !== 'message') continue
      const message = record['message']
      if (message !== null && typeof message === 'object' && !Array.isArray(message)) {
        messages.push(message)
      }
    }
  } finally {
    lines.close()
    stream.close()
  }
  return messages
}

/** Полный транскрипт файла сессии; ошибка чтения — пустая лента (канал вернёт ok:false только
 *  при отказе валидации пути, битые строки пропускаются). */
export async function readSessionTranscript(filePath: string): Promise<UiEvent[]> {
  return replaySessionEvents(await readSessionMessages(filePath))
}
