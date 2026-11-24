/** Канбан-доска: типы файла доски (spec/kanban-plan.md §1), чистые мутации, CAS-протокол.
 *  Используется main-процессом и renderer'ом; расширение pi дублирует компактную копию. */
import type { KanbanCardAttention } from './ipc-contracts'

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

/** Сессия/коммит, скопированные с комментария на карточку; at — время комментария-источника. */
export interface KanbanCardSession extends KanbanSessionRef {
  at: string
}

export interface KanbanCardCommit extends KanbanCommitRef {
  at: string
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
  sessions?: KanbanCardSession[]
  commits?: KanbanCardCommit[]
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
  '1. Rename the current session to match the task (2-3 words; if the card title is 3 words or fewer, use it as is).',
  '2. Add link to this session (sessionName) as a comment.',
  '3. If the card has Images, study them before coding — they arrive as image blocks in the kanban_pick_task/kanban_get_card result.',
  '4. Implement the task.',
  '5. When done, call kanban_move to Review and add comment to the card:',
  '   a) pass commit hashes via the commits parameter of kanban_move/kanban_comment (hash + optional message); hashes written as plain text in the comment body do not become clickable badges;',
  '   b) a short completion report.',
  '6. Never move a card to Done yourself — the user does that after review.',
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
    at: record['at'],
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

function parseCardSessions(raw: unknown): KanbanCardSession[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const parsed: KanbanCardSession[] = []
  for (const item of raw) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    if (typeof record['id'] !== 'string' || typeof record['title'] !== 'string' || !isIsoString(record['at'])) continue
    parsed.push({ id: record['id'], title: record['title'], at: record['at'] })
  }
  return parsed.length > 0 ? parsed : undefined
}

function parseCardCommits(raw: unknown): KanbanCardCommit[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const parsed: KanbanCardCommit[] = []
  for (const item of raw) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    if (typeof record['hash'] !== 'string' || typeof record['message'] !== 'string' || !isIsoString(record['at'])) continue
    parsed.push({ hash: record['hash'], message: record['message'], at: record['at'] })
  }
  return parsed.length > 0 ? parsed : undefined
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
    comments,
    sessions: parseCardSessions(record['sessions']),
    commits: parseCardCommits(record['commits']),
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
    cards,
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
    cards: [],
  }
}

function columnIndex(board: KanbanBoard, columnId: string): number {
  const index = board.columns.findIndex((column) => column.id === columnId)
  if (index < 0) throw new Error(`Column not found: ${columnId}`)
  return index
}

function cardIndex(board: KanbanBoard, cardId: string): number {
  const index = board.cards.findIndex((card) => card.id === cardId)
  if (index < 0) throw new Error(`Card not found: ${cardId}`)
  return index
}

/** order в колонке → 0..n-1 (стабильно по текущему порядку); карточки копируются. */
function reindexedCards(cards: KanbanCard[], columnId: string): KanbanCard[] {
  const inColumn = cards.filter((card) => card.columnId === columnId).sort((a, b) => a.order - b.order)
  const orders = new Map<string, number>()
  inColumn.forEach((card, index) => {
    orders.set(card.id, index)
  })
  return cards.map((card) => (orders.has(card.id) ? { ...card, order: orders.get(card.id)! } : card))
}

function withCard(board: KanbanBoard, card: KanbanCard): KanbanBoard {
  return { ...board, cards: board.cards.map((existing) => (existing.id === card.id ? card : existing)) }
}

function backlogColumnId(board: KanbanBoard): string {
  const backlog = board.columns.find((column) => column.name === 'Backlog')
  return (backlog ?? board.columns[0]).id
}

export interface CardCreateInput {
  title: string
  description?: string
  columnId?: string
  now?: string
}

export function applyCardCreate(board: KanbanBoard, input: CardCreateInput): KanbanBoard {
  const title = sanitizeKanbanTitle(input.title)
  if (title === null) throw new Error('Invalid card title')
  const columnId = input.columnId ?? backlogColumnId(board)
  columnIndex(board, columnId)
  const now = input.now ?? new Date().toISOString()
  const order = board.cards.filter((card) => card.columnId === columnId).length
  const card: KanbanCard = {
    id: newKanbanId('c'),
    title,
    description: input.description?.slice(0, KANBAN_DESCRIPTION_MAX) ?? '',
    columnId,
    order,
    createdAt: now,
    updatedAt: now,
    images: [],
    comments: [],
  }
  return { ...board, cards: [...board.cards, card] }
}

export interface CardUpdateInput {
  id: string
  title?: string
  description?: string
  /** Полная замена списка картинок (пути внутри .pi/kanban); undefined — не трогать. */
  images?: string[]
  now?: string
}

export function applyCardUpdate(board: KanbanBoard, input: CardUpdateInput): KanbanBoard {
  const index = cardIndex(board, input.id)
  const card = board.cards[index]
  const title = input.title === undefined ? card.title : sanitizeKanbanTitle(input.title)
  if (title === null) throw new Error('Invalid card title')
  const next: KanbanCard = {
    ...card,
    title,
    description: input.description === undefined ? card.description : input.description.slice(0, KANBAN_DESCRIPTION_MAX),
    images: input.images === undefined ? card.images : input.images.filter(isValidKanbanImagePath),
    updatedAt: input.now ?? new Date().toISOString(),
  }
  return withCard(board, next)
}

export function applyCardDelete(board: KanbanBoard, cardId: string): KanbanBoard {
  cardIndex(board, cardId)
  return { ...board, cards: board.cards.filter((card) => card.id !== cardId) }
}

export interface CardMoveInput {
  id: string
  columnId: string
  /** Позиция в целевой колонке; по умолчанию — в конец. */
  index?: number
  now?: string
}

export function applyCardMove(board: KanbanBoard, input: CardMoveInput): KanbanBoard {
  const sourceIndex = cardIndex(board, input.id)
  columnIndex(board, input.columnId)
  const card = board.cards[sourceIndex]
  const rest = board.cards.filter((existing) => existing.id !== input.id)
  const targetCount = rest.filter((existing) => existing.columnId === input.columnId).length
  const index = input.index === undefined ? targetCount : Math.max(0, Math.min(input.index, targetCount))
  let inserted = 0
  const cards: KanbanCard[] = []
  const movedCard = (): KanbanCard => ({ ...card, columnId: input.columnId, order: index, updatedAt: input.now ?? new Date().toISOString() })
  for (const existing of rest) {
    if (existing.columnId === input.columnId && inserted === index) {
      cards.push(movedCard())
      inserted += 1
    }
    cards.push(existing)
    if (existing.columnId === input.columnId) inserted += 1
  }
  if (inserted === index) cards.push(movedCard())
  let next: KanbanBoard = { ...board, cards: reindexedCards(cards, input.columnId) }
  if (card.columnId !== input.columnId) next = { ...next, cards: reindexedCards(next.cards, card.columnId) }
  return next
}

export interface CardCommentInput {
  id: string
  comment: KanbanComment
  now?: string
}

function mergeCardSessions(existing: KanbanCardSession[] | undefined, comment: KanbanComment): KanbanCardSession[] | undefined {
  const session = comment.session
  if (session === undefined) return existing
  const list = existing ?? []
  if (list.some((item) => item.id === session.id)) return existing
  return [...list, { id: session.id, title: session.title, at: comment.at }]
}

function mergeCardCommits(existing: KanbanCardCommit[] | undefined, comment: KanbanComment): KanbanCardCommit[] | undefined {
  if (comment.commits === undefined || comment.commits.length === 0) return existing
  const list = existing ?? []
  const known = new Set(list.map((item) => item.hash))
  const added = comment.commits
    .filter((commit) => !known.has(commit.hash))
    .map((commit) => ({ hash: commit.hash, message: commit.message, at: comment.at }))
  return added.length === 0 ? existing : [...list, ...added]
}

export function applyCardComment(board: KanbanBoard, input: CardCommentInput): KanbanBoard {
  const index = cardIndex(board, input.id)
  const card = board.cards[index]
  const next: KanbanCard = {
    ...card,
    comments: [...card.comments, input.comment],
    sessions: mergeCardSessions(card.sessions, input.comment),
    commits: mergeCardCommits(card.commits, input.comment),
    updatedAt: input.now ?? new Date().toISOString(),
  }
  return withCard(board, next)
}

export interface CommentUpdateInput {
  cardId: string
  commentId: string
  text: string
  /** Полная замена списка картинок (пути внутри .pi/kanban); undefined — не трогать. */
  images?: string[]
  now?: string
}

/** Правка только своего (author === 'user') комментария; агентские не трогаем. */
export function applyCommentUpdate(board: KanbanBoard, input: CommentUpdateInput): KanbanBoard {
  const card = board.cards.find((item) => item.id === input.cardId)
  if (card === undefined) throw new Error(`Card not found: ${input.cardId}`)
  const comment = card.comments.find((item) => item.id === input.commentId)
  if (comment === undefined) throw new Error(`Comment not found: ${input.commentId}`)
  if (comment.author !== 'user') throw new Error('Only user comments can be edited')
  const text = sanitizeKanbanText(input.text, KANBAN_COMMENT_MAX)
  if (text === null) throw new Error('Invalid comment text')
  const nextComment: KanbanComment = {
    ...comment,
    text,
    ...(input.images !== undefined ? { images: input.images.filter(isValidKanbanImagePath) } : {}),
  }
  const next: KanbanCard = {
    ...card,
    comments: card.comments.map((item) => (item.id === input.commentId ? nextComment : item)),
    updatedAt: input.now ?? new Date().toISOString(),
  }
  return withCard(board, next)
}

/** Удаление только своего (author === 'user') комментария. */
export function applyCommentDelete(board: KanbanBoard, input: { cardId: string; commentId: string }): KanbanBoard {
  const card = board.cards.find((item) => item.id === input.cardId)
  if (card === undefined) throw new Error(`Card not found: ${input.cardId}`)
  const comment = card.comments.find((item) => item.id === input.commentId)
  if (comment === undefined) throw new Error(`Comment not found: ${input.commentId}`)
  if (comment.author !== 'user') throw new Error('Only user comments can be deleted')
  const next: KanbanCard = {
    ...card,
    comments: card.comments.filter((item) => item.id !== input.commentId),
    updatedAt: new Date().toISOString(),
  }
  return withCard(board, next)
}

export function applyColumnCreate(board: KanbanBoard, name: string): KanbanBoard {
  const columnName = sanitizeKanbanName(name)
  if (columnName === null) throw new Error('Invalid column name')
  return { ...board, columns: [...board.columns, { id: newKanbanId('col'), name: columnName }] }
}

export function applyColumnRename(board: KanbanBoard, input: { id: string; name: string }): KanbanBoard {
  columnIndex(board, input.id)
  const columnName = sanitizeKanbanName(input.name)
  if (columnName === null) throw new Error('Invalid column name')
  return {
    ...board,
    columns: board.columns.map((column) => (column.id === input.id ? { ...column, name: columnName } : column)),
  }
}

/** Карточки удаляемой колонки переезжают в Backlog (иначе в первую колонку), в конец. */
export function applyColumnDelete(board: KanbanBoard, columnId: string): KanbanBoard {
  columnIndex(board, columnId)
  if (board.columns.length === 1) throw new Error('Cannot delete the last column')
  const targetId = backlogColumnId(board) === columnId ? board.columns.find((column) => column.id !== columnId)!.id : backlogColumnId(board)
  const now = new Date().toISOString()
  const moved = board.cards
    .filter((card) => card.columnId === columnId)
    .sort((a, b) => a.order - b.order)
    .map((card) => ({ ...card, columnId: targetId, updatedAt: now }))
  const targetCount = board.cards.filter((card) => card.columnId === targetId).length
  moved.forEach((card, index) => {
    card.order = targetCount + index
  })
  return {
    ...board,
    columns: board.columns.filter((column) => column.id !== columnId),
    cards: [...board.cards.filter((card) => card.columnId !== columnId), ...moved],
  }
}

/** Очистка колонки: все её карточки удаляются. */
export function applyColumnClear(board: KanbanBoard, columnId: string): KanbanBoard {
  columnIndex(board, columnId)
  return { ...board, cards: board.cards.filter((card) => card.columnId !== columnId) }
}

export interface ColumnCardsMoveInput {
  id: string
  targetColumnId: string
  now?: string
}

/** Все карточки колонки переезжают в целевую (в конец, относительный порядок сохраняется). */
export function applyColumnCardsMove(board: KanbanBoard, input: ColumnCardsMoveInput): KanbanBoard {
  columnIndex(board, input.id)
  columnIndex(board, input.targetColumnId)
  if (input.id === input.targetColumnId) return board
  const now = input.now ?? new Date().toISOString()
  const moved = board.cards
    .filter((card) => card.columnId === input.id)
    .sort((a, b) => a.order - b.order)
    .map((card) => ({ ...card, columnId: input.targetColumnId, updatedAt: now }))
  const targetCount = board.cards.filter((card) => card.columnId === input.targetColumnId).length
  moved.forEach((card, index) => {
    card.order = targetCount + index
  })
  return { ...board, cards: [...board.cards.filter((card) => card.columnId !== input.id), ...moved] }
}

export function applyColumnMove(board: KanbanBoard, input: { id: string; index: number }): KanbanBoard {
  columnIndex(board, input.id)
  const index = Math.max(0, Math.min(input.index, board.columns.length - 1))
  const columns = board.columns.filter((column) => column.id !== input.id)
  columns.splice(index, 0, board.columns.find((column) => column.id === input.id)!)
  return { ...board, columns }
}

export function applyWorkflowSet(board: KanbanBoard, text: string): KanbanBoard {
  return { ...board, workflow: text.slice(0, KANBAN_WORKFLOW_MAX) }
}

export function applyBoardRename(board: KanbanBoard, name: string): KanbanBoard {
  const boardName = sanitizeKanbanName(name)
  if (boardName === null) throw new Error('Invalid board name')
  return { ...board, name: boardName }
}

export interface ClaimResult {
  board: KanbanBoard
  card: KanbanCard
}

/** Claim: первая карточка Todo (иначе Backlog) → In Progress. Нет кандидата или колонки — null. */
export function claimNextCard(board: KanbanBoard, now = new Date().toISOString()): ClaimResult | null {
  const target = board.columns.find((column) => column.name === 'In Progress')
  if (target === undefined) return null
  for (const sourceName of ['Todo', 'Backlog']) {
    const source = board.columns.find((column) => column.name === sourceName)
    if (source === undefined) continue
    const candidates = board.cards
      .filter((card) => card.columnId === source.id)
      .sort((a, b) => a.order - b.order)
    if (candidates.length === 0) continue
    const claimed = candidates[0]
    const next = applyCardMove(board, { id: claimed.id, columnId: target.id, now })
    return { board: next, card: next.cards.find((card) => card.id === claimed.id)! }
  }
  return null
}

/** Хранилище досок для CAS. write бросает KanbanConflictError, если rev на диске уже другой. */
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

/** UI прислал устаревший rev снимка: мутация с полными заменами полей (описание, картинки)
 *  затёрла бы правки агента. Не ретраится — доску нужно перечитать. */
export class KanbanStaleRevError extends Error {
  constructor(expected: number, actual: number) {
    super(`Board has changed (snapshot rev ${expected}, actual ${actual}) — refresh the board and retry`)
    this.name = 'KanbanStaleRevError'
  }
}

export const KANBAN_CAS_MAX_ATTEMPTS = 10

function casDelay(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 30 + attempt * 40 + Math.random() * 150))
}

/** CAS-мутация: read → mutate → write; конфликт rev — перечитать и повторить (до 10 попыток).
 *  mutate вернул null или тот же объект доски — записи нет, возвращается value/null. */
export async function casMutate<T>(
  store: KanbanBoardStore,
  boardId: string,
  mutate: (board: KanbanBoard) => { board: KanbanBoard; value: T } | null,
): Promise<T | null> {
  for (let attempt = 0; attempt < KANBAN_CAS_MAX_ATTEMPTS; attempt += 1) {
    const current = await store.read(boardId)
    if (current === null) throw new Error(`Board not found: ${boardId}`)
    const outcome = mutate(current)
    if (outcome === null || outcome.board === current) return outcome === null ? null : outcome.value
    try {
      await store.write({ ...outcome.board, rev: current.rev + 1 })
      return outcome.value
    } catch (error) {
      if (!(error instanceof KanbanConflictError)) throw error
      await casDelay(attempt)
    }
  }
  throw new Error(`Kanban CAS failed after ${KANBAN_CAS_MAX_ATTEMPTS} attempts: ${boardId}`)
}

/** Атомарный pick: claim первой карточки; при конфликте перечитываем — берём следующую. */
export async function pickTask(store: KanbanBoardStore, boardId: string, now = new Date().toISOString()): Promise<KanbanCard | null> {
  return casMutate(store, boardId, (board) => {
    const claimed = claimNextCard(board, now)
    if (claimed === null) return { board, value: null }
    return { board: claimed.board, value: claimed.card }
  })
}

/** Ключ карточки в kanbanCardAttention. */
export function cardAttentionKey(boardId: string, cardId: string): string {
  return `${boardId}\u0000${cardId}`
}

/** Санитайзер settings.kanbanCardAttention: строковые ключи проекта, дедуп непустых строк,
 *  пустые записи выкидываются (файл настроек не разрастается). */
export function mergeKanbanCardAttention(value: unknown): Record<string, KanbanCardAttention> {
  const out: Record<string, KanbanCardAttention> = {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return out
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (key.length === 0 || raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
    const entry: KanbanCardAttention = { sessions: [], dismissed: [] }
    for (const field of ['sessions', 'dismissed'] as const) {
      const list = (raw as Record<string, unknown>)[field]
      if (!Array.isArray(list)) continue
      const seen = new Set<string>()
      for (const item of list) if (typeof item === 'string' && item.length > 0) seen.add(item)
      entry[field] = [...seen]
    }
    if (entry.sessions.length > 0 || entry.dismissed.length > 0) out[key] = entry
  }
  return out
}

/** Сессия карточки, которой светится зелёная точка: непрочитанная закрытая сессия,
 *  ещё не снятая открытием карточки; newest — с самым поздним комментарием. */
export function attentionSessionOfCard(
  card: KanbanCard,
  boardId: string,
  attention: KanbanCardAttention | undefined,
): KanbanCardSession | null {
  if (attention === undefined || attention.sessions.length === 0) return null
  if (attention.dismissed.includes(cardAttentionKey(boardId, card.id))) return null
  const pending = new Set(attention.sessions)
  const hit = (card.sessions ?? [])
    .filter((s) => pending.has(s.id))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))[0]
  return hit ?? null
}
