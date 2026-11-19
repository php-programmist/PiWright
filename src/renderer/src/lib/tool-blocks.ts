/** Разобранный заголовок блока инструмента: иконка, имя, приглушённая деталь.
 *  Порт `ui/ToolBlocks.kt` (без IDE-специфики) и `extensionForLanguage` из `ui/MarkdownBlocks.kt`. */
import type { ToolCall } from '../../../shared/agent-events'

export interface ToolHeader {
  icon: string
  title: string
  detail: string
}

function str(args: Record<string, unknown>, key: string): string | null {
  const value = args[key]
  return typeof value === 'string' ? value : null
}

/** Иконка по имени инструмента pi (встроенные read/edit/write/bash, остальное — расширения). */
export function iconForTool(name: string): string {
  switch (name) {
    case 'read':
      return '📖'
    case 'edit':
    case 'write':
      return '✏️'
    case 'bash':
      return '⚡'
    default:
      return '🔧'
  }
}

/** Полная команда bash-инструмента, иначе null. */
export function bashCommand(call: ToolCall): string | null {
  if (call.name !== 'bash') return null
  const command = str(call.args, 'command')
  return command !== null && command.trim().length > 0 ? command : null
}

/** Заголовок bash-блока: вся команда, многострочная схлопывается в одну строку. */
export function terminalTitle(command: string): string {
  return `bash: ${command.replace(/\s+/g, ' ').trim()}`
}

function compactArgs(call: ToolCall): string {
  const keys = Object.keys(call.args)
  if (keys.length === 0) return ''
  return JSON.stringify(call.args).replace(/\s+/g, ' ').slice(0, MAX_ARGS_DETAIL)
}

/** Заголовок свёрнутого блока: у bash — вся команда, у файловых — путь, у прочих — аргументы. */
export function toolHeader(call: ToolCall): ToolHeader {
  const command = bashCommand(call)
  if (command !== null) return { icon: iconForTool(call.name), title: terminalTitle(command), detail: '' }
  const detail = str(call.args, 'path') ?? compactArgs(call)
  return { icon: iconForTool(call.name), title: call.name, detail }
}

/** Тексты «до» и «после» правки `edit`: `edits[].oldText` и `newText` через разделитель. */
export function editTexts(call: ToolCall): [string, string] | null {
  if (call.name !== 'edit') return null
  const edits = call.args['edits']
  if (!Array.isArray(edits)) return null
  const pairs = edits
    .filter((e): e is Record<string, unknown> => e !== null && typeof e === 'object' && !Array.isArray(e))
    .map((e) => [typeof e['oldText'] === 'string' ? e['oldText'] : '', typeof e['newText'] === 'string' ? e['newText'] : ''] as [string, string])
  if (pairs.length === 0) return null
  return [
    pairs.map((p) => p[0]).join(EDIT_SEPARATOR),
    pairs.map((p) => p[1]).join(EDIT_SEPARATOR)
  ]
}

const MAX_ARGS_DETAIL = 120
const EDIT_SEPARATOR = '\n⋯\n'

/** Инфо-строка fenced-блока → id языка Shiki. Порт `extensionForLanguage`. */
export function shikiLanguage(language: string | null): string {
  switch ((language ?? '').toLowerCase()) {
    case 'kotlin':
    case 'kt':
    case 'kts':
      return 'kt'
    case 'java':
      return 'java'
    case 'php':
      return 'php'
    case 'go':
    case 'golang':
      return 'go'
    case 'python':
    case 'py':
      return 'py'
    case 'javascript':
    case 'js':
    case 'jsx':
      return 'js'
    case 'typescript':
    case 'ts':
    case 'tsx':
      return 'ts'
    case 'json':
      return 'json'
    case 'xml':
      return 'xml'
    case 'html':
      return 'html'
    case 'css':
      return 'css'
    case 'yaml':
    case 'yml':
      return 'yml'
    case 'sql':
      return 'sql'
    case 'bash':
    case 'sh':
    case 'shell':
    case 'zsh':
      return 'sh'
    case 'markdown':
    case 'md':
      return 'md'
    default:
      return 'txt'
  }
}
