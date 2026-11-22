/** Компактная копия storage-ядра канбана (src/shared/kanban.ts) для расширения pi:
 *  расширение выкладывается в ~/.pi/agent/piwright/kanban как самостоятельные файлы
 *  и не может импортировать src/shared. Чистые мутации добавляются тикетами тулов. */

export interface KanbanColumn {
  id: string
  name: string
}

export interface KanbanSessionRef {
  id: string
  title: string
}

export interface KanbanCommitRef {
  hash: string
  message: string
}

export interface KanbanComment {
  id: string
  author: 'user' | 'agent'
  text: string
  images: string[]
  at: string
  session?: KanbanSessionRef
  commits?: KanbanCommitRef[]
}

export interface KanbanCard {
  id: string
  title: string
  description: string
  columnId: string
  order: number
  createdAt: string
  updatedAt: string
  images: string[]
  comments: KanbanComment[]
}

export interface KanbanBoard {
  version: 1
  id: string
  name: string
  rev: number
  workflow: string
  columns: KanbanColumn[]
  cards: KanbanCard[]
}

export const KANBAN_DEFAULT_COLUMNS = ['Backlog', 'Todo', 'In Progress', 'Review', 'Done'] as const

export const KANBAN_DEFAULT_WORKFLOW = [
  '1. Call kanban_pick_task to take a card from Todo (fallback: Backlog); the card moves to In Progress.',
  '2. Rename the current session to match the task (2-3 words; if the card title is 3 words or fewer, use it as is).',
  '3. Implement the task.',
  '4. When done, call kanban_move to Review and add two comments to the card:',
  '   a) a link to this session (sessionName) and the hashes of your commits;',
  '   b) a short completion report.',
  '5. Never move a card to Done yourself — the user does that after review.'
].join('\n')

const KANBAN_ID_HEX = '[0-9a-f]{8}'
const KANBAN_ID_SUFFIX_REGEX = new RegExp(`^${KANBAN_ID_HEX}$`)

export function isValidKanbanId(id: unknown, prefix: 'b' | 'col' | 'c' | 'm'): id is string {
  return typeof id === 'string' && id.startsWith(`${prefix}-`) && KANBAN_ID_SUFFIX_REGEX.test(id.slice(prefix.length + 1))
}

export function newKanbanId(prefix: 'b' | 'col' | 'c' | 'm'): string {
  const hex = crypto.randomUUID().replace(/-/g, '').slice(0, 8)
  return `${prefix}-${hex}`
}

const KANBAN_NAME_MAX = 200
const KANBAN_TITLE_MAX = 300
const KANBAN_DESCRIPTION_MAX = 10000
export const KANBAN_COMMENT_MAX = 10000
const KANBAN_WORKFLOW_MAX = 20000

/** Строка после trim: непустая и не длиннее max; иначе null. */
export function sanitizeKanbanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > max) return null
  return trimmed
}

export function sanitizeKanbanName(value: unknown): string | null {
  return sanitizeKanbanText(value, KANBAN_NAME_MAX)
}

export function sanitizeKanbanTitle(value: unknown): string | null {
  return sanitizeKanbanText(value, KANBAN_TITLE_MAX)
}

/** Путь картинки внутри .pi/kanban: относительный, без «..», не пустой. */
export function isValidKanbanImagePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 500) return false
  if (value.includes('\\') || value.startsWith('/')) return false
  return value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

function isIsoString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value))
}

function sanitizeStringArray(value: unknown, isValid: (item: unknown) => boolean): string[] {
  if (!Array.isArray(value)) return []
  return value.filter(isValid)
}

function parseComment(raw: unknown): KanbanComment | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  if (!isValidKanbanId(record['id'], 'm')) return null
  const author = record['author']
  if (author !== 'user' && author !== 'agent') return null
  const text = record['text']
  if (typeof text !== 'string' || text.length > KANBAN_COMMENT_MAX) return null
  if (!isIsoString(record['at'])) return null
  const comment: KanbanComment = {
    id: record['id'],
    author,
    text,
    images: sanitizeStringArray(record['images'], isValidKanbanImagePath),
    at: record['at']
  }
  const session = record['session']
  if (session !== null && typeof session === 'object' && !Array.isArray(session)) {
    const sessionRecord = session as Record<string, unknown>
    if (typeof sessionRecord['id'] === 'string' && typeof sessionRecord['title'] === 'string') {
      comment.session = { id: sessionRecord['id'], title: sessionRecord['title'] }
    }
  }
  const commits = record['commits']
  if (Array.isArray(commits)) {
    const parsed: KanbanCommitRef[] = []
    for (const item of commits) {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
      const commitRecord = item as Record<string, unknown>
      if (typeof commitRecord['hash'] !== 'string' || typeof commitRecord['message'] !== 'string') continue
      parsed.push({ hash: commitRecord['hash'], message: commitRecord['message'] })
    }
    if (parsed.length > 0) comment.commits = parsed
  }
  return comment
}

function parseCard(raw: unknown, columnIds: Set<string>): KanbanCard | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  if (!isValidKanbanId(record['id'], 'c')) return null
  const title = record['title']
  if (typeof title !== 'string' || title.length === 0 || title.length > KANBAN_TITLE_MAX) return null
  const columnId = record['columnId']
  if (typeof columnId !== 'string' || !columnIds.has(columnId)) return null
  const order = record['order']
  if (typeof order !== 'number' || !Number.isInteger(order)) return null
  if (!isIsoString(record['createdAt']) || !isIsoString(record['updatedAt'])) return null
  const description = record['description']
  const commentsRaw = record['comments']
  const comments: KanbanComment[] = []
  if (Array.isArray(commentsRaw)) {
    for (const item of commentsRaw) {
      const comment = parseComment(item)
      if (comment !== null) comments.push(comment)
    }
  }
  return {
    id: record['id'],
    title,
    description: typeof description === 'string' ? description.slice(0, KANBAN_DESCRIPTION_MAX) : '',
    columnId,
    order,
    createdAt: record['createdAt'],
    updatedAt: record['updatedAt'],
    images: sanitizeStringArray(record['images'], isValidKanbanImagePath),
    comments
  }
}

/** Доска из прочитанного JSON: невалидные поля/записи отбрасываются, битая структура — null. */
export function parseKanbanBoard(raw: unknown): KanbanBoard | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const record = raw as Record<string, unknown>
  if (record['version'] !== 1) return null
  if (!isValidKanbanId(record['id'], 'b')) return null
  const rev = record['rev']
  if (typeof rev !== 'number' || !Number.isInteger(rev) || rev < 0) return null
  const columnsRaw = record['columns']
  if (!Array.isArray(columnsRaw)) return null
  const columns: KanbanColumn[] = []
  const columnIds = new Set<string>()
  for (const item of columnsRaw) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    const columnRecord = item as Record<string, unknown>
    if (!isValidKanbanId(columnRecord['id'], 'col') || columnIds.has(columnRecord['id'])) continue
    const name = sanitizeKanbanName(columnRecord['name'])
    if (name === null) continue
    columnIds.add(columnRecord['id'])
    columns.push({ id: columnRecord['id'], name })
  }
  if (columns.length === 0) return null
  const cardsRaw = record['cards']
  const cards: KanbanCard[] = []
  if (Array.isArray(cardsRaw)) {
    for (const item of cardsRaw) {
      const card = parseCard(item, columnIds)
      if (card !== null) cards.push(card)
    }
  }
  const workflow = record['workflow']
  return {
    version: 1,
    id: record['id'],
    name: sanitizeKanbanName(record['name']) ?? 'Default',
    rev,
    workflow: typeof workflow === 'string' ? workflow.slice(0, KANBAN_WORKFLOW_MAX) : '',
    columns,
    cards
  }
}

export function createDefaultBoard(name = 'Default', id = newKanbanId('b')): KanbanBoard {
  const columns = KANBAN_DEFAULT_COLUMNS.map((columnName) => ({ id: newKanbanId('col'), name: columnName }))
  return {
    version: 1,
    id,
    name,
    rev: 0,
    workflow: KANBAN_DEFAULT_WORKFLOW,
    columns,
    cards: []
  }
}

/** Хранилище досок для CAS (реализация fs — в lib/store.ts; write бросает
 *  KanbanConflictError, если rev на диске уже другой). */
export interface KanbanBoardStore {
  read(boardId: string): Promise<KanbanBoard | null>
  write(board: KanbanBoard): Promise<void>
}

export class KanbanConflictError extends Error {
  constructor() {
    super('Kanban board changed concurrently')
    this.name = 'KanbanConflictError'
  }
}
