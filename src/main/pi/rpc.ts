/** Кодек JSONL-протокола pi. Порт `core/rpc/PiRpc.kt`. */
import type { PiInbound, PiJsonObject, PiResponse } from '../../shared/protocol-types'

/** Команда — одна JSON-строка: `{id, type, ...fields}`. Поля копируются как есть. */
export function encodeCommand(id: string, type: string, fields?: PiJsonObject | null): string {
  return JSON.stringify({ id, type, ...fields })
}

/** Ответ на диалог расширения: `{type:"extension_ui_response", id, ...fields}`. */
export function encodeExtensionUiResponse(id: string, fields: PiJsonObject): string {
  return JSON.stringify({ type: 'extension_ui_response', id, ...fields })
}

function str(obj: PiJsonObject, key: string): string | null {
  const value = obj[key]
  return typeof value === 'string' ? value : null
}

function bool(obj: PiJsonObject, key: string): boolean {
  const value = obj[key]
  return typeof value === 'boolean' ? value : false
}

/** Разбирает одну строку. Мусор / не-объект / без `type` — null, не исключение. */
export function parseInbound(line: string): PiInbound | null {
  let root: unknown
  try {
    root = JSON.parse(line)
  } catch {
    return null
  }
  if (root === null || typeof root !== 'object' || Array.isArray(root)) return null
  const obj = root as PiJsonObject
  const type = str(obj, 'type')
  if (type === null) return null
  if (type === 'response') {
    const response: PiResponse = {
      id: str(obj, 'id'),
      command: str(obj, 'command') ?? '',
      success: bool(obj, 'success'),
      data: 'data' in obj && obj.data !== null && obj.data !== undefined ? obj.data : null,
      error: str(obj, 'error')
    }
    return { kind: 'response', response }
  }
  if (type === 'extension_ui_request') {
    const id = str(obj, 'id')
    const method = str(obj, 'method')
    if (id === null || method === null) return null
    return { kind: 'extensionUiRequest', id, method, payload: obj }
  }
  return { kind: 'event', type, payload: obj }
}
