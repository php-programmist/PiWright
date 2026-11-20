/** Todo-виджет расширений (порт `ExtensionUi.parseTodoJsonTodos` + plan-mode fallback).
 *  pi-todo шлёт ключ `pi-agent-desktop:todo` — одна задача на JSON-строке; plan-mode шлёт
 *  `plan-todos` глифами (☑ выполнено, ☐ ожидает). */
export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export interface TodoItem {
  subject: string
  status: TodoStatus
}

export const TODO_WIDGET_KEY = 'pi-agent-desktop:todo'
export const PLAN_WIDGET_KEY = 'plan-todos'

function todoStatus(value: unknown): TodoStatus | null {
  return value === 'pending' || value === 'in_progress' || value === 'completed' ? value : null
}

function fromJson(line: string): TodoItem | null {
  let root: unknown
  try {
    root = JSON.parse(line)
  } catch {
    return null
  }
  if (root === null || typeof root !== 'object' || Array.isArray(root)) return null
  const record = root as Record<string, unknown>
  const subject = record['subject']
  const status = todoStatus(record['status'])
  if (typeof subject !== 'string' || subject.trim().length === 0 || status === null) return null
  return { subject, status }
}

function fromGlyph(line: string): TodoItem | null {
  if (!/^[\u2611\u2713\u2714\u2610\u25A1\u25CB\u25CF]/.test(line)) return null
  const text = line.replace(/^[\u2611\u2713\u2714\u2610\u25A1\u25CB\u25CF]\s*/, '').trim()
  if (text.length === 0) return null
  const completed = /^[\u2611\u2713\u2714]/.test(line)
  return { subject: text, status: completed ? 'completed' : 'pending' }
}

/** Строки виджета → задачи. JSON-строки дают точный статус, глиф-строки — pending/completed;
 *  если in_progress нет ни у одной, первый pending становится текущим. */
export function parseTodoLines(lines: string[]): TodoItem[] {
  const items = lines
    .map((line) => fromJson(line) ?? fromGlyph(line))
    .filter((item): item is TodoItem => item !== null)
  if (!items.some((item) => item.status === 'in_progress')) {
    const first = items.find((item) => item.status === 'pending')
    if (first !== undefined) first.status = 'in_progress'
  }
  return items
}
