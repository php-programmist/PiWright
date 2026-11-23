/** Генерация названия сессии (2-3 слова) одноразовым pi: RPC без сессии, расширений и инструментов,
 *  модель — та же, что у реальной сессии. Порт паттерна generateCommitMessage из git-service. */
import type { PiSpawner } from './backends/types'
import { PiConnection } from './connection'

const TITLE_TIMEOUT_MS = 30_000
const MAX_TITLE_CHARS = 60
const MAX_MESSAGE_CHARS = 2000

export function truncateTitleMessage(message: string): string {
  return message.length <= MAX_MESSAGE_CHARS ? message : `${message.slice(0, MAX_MESSAGE_CHARS)}…`
}

export function buildTitlePrompt(message: string): string {
  return [
    'Invent a short title for a chat session based on the user message below.',
    '',
    'Rules:',
    '- Reply with the title text only: no explanations, no quotes, no markdown.',
    '- 2-3 words, in the same language as the message.',
    '- No trailing period.',
    '',
    'User message:',
    '',
    truncateTitleMessage(message)
  ].join('\n')
}

/** Разметка tool-call в ответе модели — признак того, что название не придумано. */
const TOOL_CALL_MARKUP = /<\/?(?:tool_call|function_call|function|parameter|invoke)\b[^>]*>/i

/** Запасное название: первые 3 слова сообщения, суммарно не более 20 символов. */
export function fallbackTitle(message: string): string {
  const words = message.trim().split(/\s+/).slice(0, 3).join(' ')
  return words.length > 20 ? words.slice(0, 20).trimEnd() : words
}

/** Ответ модели: первая непустая строка без заборов/кавычек, схлопнутые пробелы, лимит длины.
 *  Разметка tool-call отвергается — пустая строка означает неудачу подбора названия. */
export function cleanSessionTitle(raw: string): string {
  let text = raw.trim()
  const fenced = text.match(/^```[^\n]*\n([\s\S]*?)\n?```$/)
  if (fenced !== null) text = fenced[1]
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (line === undefined) return ''
  const unwrapped = line.replace(/^["'«“]+/, '').replace(/["'»”]+$/, '').trim()
  const collapsed = unwrapped.replace(/\s+/g, ' ')
  if (collapsed.length === 0 || TOOL_CALL_MARKUP.test(collapsed)) return ''
  return collapsed.length > MAX_TITLE_CHARS ? `${collapsed.slice(0, MAX_TITLE_CHARS - 1).trimEnd()}…` : collapsed
}

/** Название или null при любой неудаче (таймаут, падение процесса, пустой ответ). */
export function generateSessionTitle(
  spawner: PiSpawner,
  cwd: string,
  modelKey: string | null,
  message: string,
  timeoutMs: number = TITLE_TIMEOUT_MS
): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    let text = ''
    let done = false
    let timer: NodeJS.Timeout | null = null
    const finish = (title: string | null): void => {
      if (done) return
      done = true
      if (timer !== null) clearTimeout(timer)
      conn.close()
      resolve(title)
    }
    const conn = new PiConnection(spawner, {
      onEvent: (type, payload) => {
        if (type === 'message_update') {
          const event = payload['assistantMessageEvent']
          if (event !== null && typeof event === 'object' && (event as Record<string, unknown>)['type'] === 'text_delta') {
            const delta = (event as Record<string, unknown>)['delta']
            if (typeof delta === 'string') text += delta
          }
          return
        }
        if (type === 'agent_settled') {
          const title = cleanSessionTitle(text)
          finish(title.length > 0 ? title : null)
        }
      },
      onExtensionUiRequest: () => {},
      onDisconnected: () => finish(null)
    })
    timer = setTimeout(() => finish(null), timeoutMs)
    timer.unref()
    void (async () => {
      try {
        const args = ['--mode', 'rpc', '--no-session', '--no-extensions', '--no-tools', '--no-mcp']
        await conn.start({ cwd, args })
        await conn.request('get_state')
        if (modelKey !== null) {
          const slash = modelKey.indexOf('/')
          const provider = slash > 0 ? modelKey.slice(0, slash) : modelKey
          const modelId = slash > 0 ? modelKey.slice(slash + 1) : modelKey
          const switched = await conn.request('set_model', { provider, modelId })
          if (!switched.success) {
            finish(null)
            return
          }
        }
        const response = await conn.request('prompt', { message: buildTitlePrompt(message) })
        if (!response.success) finish(null)
      } catch {
        finish(null)
      }
    })()
  })
}
