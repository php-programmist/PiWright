/** Диалоги расширений pi: декодирование `extension_ui_request` и кодирование ответа.
 *  Порт `PiSession.decodeExtensionDialog` / `encodeDialogAnswer` + `ExtensionUi.stripAnsi`. */
import type { DialogAnswer, ExtensionDialog } from '../../shared/agent-events'
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
    case 'input':
      return { kind: 'input', title, placeholder: str(payload, 'placeholder'), timeoutMs }
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
