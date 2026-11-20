/** Диалоги расширений pi: декодирование `extension_ui_request` и кодирование ответа.
 *  Порт `PiSession.decodeExtensionDialog` / `encodeDialogAnswer` + `ExtensionUi.stripAnsi`
 *  и `AskQuestion.kt` (опрос `ask_question` — `input`-запрос с base64-JSON в заголовке). */
import { Buffer } from 'node:buffer'
import type { DialogAnswer, ExtensionDialog } from '../../shared/agent-events'
import { ASK_PAYLOAD_PREFIX } from '../../shared/ask-questions'
import type { AskOption, AskQuestionItem, AskQuestionRequest } from '../../shared/ask-questions'
import type { PiJsonObject } from '../../shared/protocol-types'
import { array, str } from './event-translator'

const ANSI_CSI = /\u001B\[[0-9;?]*[A-Za-z]/g

/** Расширения красят текст темой TUI (`theme.fg`) — в RPC это сырые ANSI-коды. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_CSI, '')
}

/** Заголовок select-запроса несёт и тело: первая строка — заголовок, остальное — тело карточки. */
export function splitDialogTitleBody(title: string): [string, string] {
  const nl = title.indexOf('\n')
  if (nl < 0) return [title, '']
  return [title.slice(0, nl), title.slice(nl + 1).trim()]
}

function askOption(value: unknown): AskOption | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const label = typeof record['label'] === 'string' && record['label'].length > 0 ? record['label'] : null
  if (label === null) return null
  const text = (key: string): string | null => {
    const v = record[key]
    return typeof v === 'string' && v.trim().length > 0 ? v : null
  }
  return { label, description: typeof record['description'] === 'string' ? record['description'] : '', preview: text('preview'), recommendedReason: text('recommendedReason') }
}

function askQuestion(value: unknown): AskQuestionItem | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const question = typeof record['question'] === 'string' && record['question'].trim().length > 0 ? record['question'] : null
  if (question === null) return null
  const options = (Array.isArray(record['options']) ? record['options'] : [])
    .map(askOption)
    .filter((o): o is AskOption => o !== null)
  if (options.length === 0) return null
  return {
    header: typeof record['header'] === 'string' ? record['header'] : '',
    question,
    options,
    multiSelect: record['multiSelect'] === true
  }
}

/** Декодирует пачку вопросов из заголовка `input`-запроса; null — не наш формат или битый JSON. */
export function decodeAskQuestionRequest(title: string): AskQuestionRequest | null {
  if (!title.startsWith(ASK_PAYLOAD_PREFIX)) return null
  let json: string
  try {
    json = Buffer.from(title.slice(ASK_PAYLOAD_PREFIX.length), 'base64').toString('utf8')
  } catch {
    return null
  }
  let root: unknown
  try {
    root = JSON.parse(json)
  } catch {
    return null
  }
  if (root === null || typeof root !== 'object' || Array.isArray(root)) return null
  const rawQuestions = (root as Record<string, unknown>)['questions']
  if (!Array.isArray(rawQuestions)) return null
  const questions = rawQuestions.map(askQuestion).filter((q): q is AskQuestionItem => q !== null)
  return questions.length > 0 ? { questions } : null
}

export function decodeExtensionDialog(method: string, payload: PiJsonObject): ExtensionDialog | null {
  const title = str(payload, 'title') ?? ''
  const timeoutRaw = payload['timeout']
  const timeoutMs = typeof timeoutRaw === 'number' && Number.isFinite(timeoutRaw) ? timeoutRaw : null
  switch (method) {
    case 'confirm':
      return { kind: 'confirm', title, message: str(payload, 'message'), timeoutMs }
    case 'select': {
      const [header, body] = splitDialogTitleBody(title)
      return { kind: 'select', title: header, body: body.length > 0 ? body : null, options: array(payload, 'options').filter((v): v is string => typeof v === 'string'), timeoutMs }
    }
    case 'input': {
      const ask = decodeAskQuestionRequest(title)
      if (ask !== null) return { kind: 'ask', request: ask, timeoutMs }
      return { kind: 'input', title, placeholder: str(payload, 'placeholder'), timeoutMs }
    }
    case 'editor':
      return { kind: 'editor', title, prefill: str(payload, 'prefill'), timeoutMs }
    default:
      return null
  }
}

export function encodeDialogAnswer(answer: DialogAnswer): PiJsonObject {
  switch (answer.kind) {
    case 'confirmed':
      return { confirmed: answer.confirmed }
    case 'value':
      return { value: answer.value }
    case 'cancelled':
      return { cancelled: true }
  }
}
