/** Логика тулов карточек канбана (spec/kanban-plan.md §2, §5). Не зависит от pi —
 *  регистрация в index.ts, тесты гоняют функции напрямую с tmp-каталогами. */
import { access, copyFile, mkdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'
import {
  applyCardComment,
  applyCardCreate,
  applyCardMove,
  applyCardUpdate,
  applyColumnCreate,
  applyColumnDelete,
  applyColumnMove,
  applyColumnRename,
  applyWorkflowSet,
  casMutate,
  isValidKanbanId,
  isValidKanbanImagePath,
  KANBAN_COMMENT_MAX,
  KANBAN_WORKFLOW_MAX,
  newKanbanId,
  pickTask,
  sanitizeKanbanText,
  sanitizeKanbanTitle,
  type KanbanBoard,
  type KanbanCard,
  type KanbanColumn,
  type KanbanComment,
  type KanbanCommitRef
} from './core'
import { boardsDir, createFsStore, findBoard, readBoard } from './store'
import { resolveKanbanRoot } from './root'

export interface KanbanToolEnv {
  cwd: string
  session?: { id: string; name?: string }
}

export interface KanbanToolResult {
  text: string
  details?: Record<string, unknown>
  images?: { data: string; mimeType: string }[]
}

interface BoardContext {
  root: string
  dir: string
  board: KanbanBoard
}

async function boardContext(env: KanbanToolEnv, boardParam?: string): Promise<BoardContext> {
  const root = await resolveKanbanRoot(env.cwd)
  const board = await findBoard(root, boardParam)
  return { root, dir: boardsDir(root), board }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function findColumn(board: KanbanBoard, param: string): KanbanColumn | null {
  const needle = param.trim().toLowerCase()
  return board.columns.find((column) => column.id === param || column.name.toLowerCase() === needle) ?? null
}

function columnNames(board: KanbanBoard): string {
  return board.columns.map((column) => column.name).join(', ')
}

function cardLine(board: KanbanBoard, card: KanbanCard): string {
  const column = board.columns.find((item) => item.id === card.columnId)
  return `- ${card.id} [${column?.name ?? card.columnId}] ${card.title}`
}

function requireCardId(id: string): string | null {
  return isValidKanbanId(id, 'c') ? id : null
}

const ATTACHMENT_NAME_MAX = 80

function sanitizeAttachmentFileName(path: string): string {
  const base = basename(path).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, ATTACHMENT_NAME_MAX)
  return base.length > 0 ? base : 'image.bin'
}

/** Копия файлов картинок в `.pi/kanban/attachments/`; пути в карточке — `attachments/<name>`. */
async function copyAttachments(
  root: string,
  cwd: string,
  paths: unknown
): Promise<{ copied: string[]; failed: string[] }> {
  const copied: string[] = []
  const failed: string[] = []
  if (!Array.isArray(paths)) return { copied, failed }
  const dir = join(boardsDir(root), 'attachments')
  for (const item of paths) {
    if (typeof item !== 'string' || item.trim() === '') continue
    const source = resolve(cwd, item.trim())
    try {
      const info = await stat(source)
      if (!info.isFile()) throw new Error('not a file')
      await mkdir(dir, { recursive: true })
      const base = sanitizeAttachmentFileName(source)
      const ext = extname(base)
      const stem = ext.length > 0 ? base.slice(0, -ext.length) : base
      let name = base
      for (let i = 1; i < 1000; i += 1) {
        try {
          await access(join(dir, name))
        } catch {
          break
        }
        name = `${stem}-${i}${ext}`
      }
      await copyFile(source, join(dir, name))
      copied.push(`attachments/${name}`)
    } catch {
      failed.push(item.trim())
    }
  }
  return { copied, failed }
}

const IMAGE_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp'
}

const MAX_INLINE_IMAGES = 10

interface InlineImage {
  data: string
  mimeType: string
}

/** Картинки вложений (пути `attachments/<name>` внутри boardsDir) → base64-блоки для модели и
 *  строки-описания. Относительный путь `attachments/...` от cwd агента не читается, поэтому в
 *  строках печатается абсолютный путь — fallback для read, когда inline-блок не загружен. */
async function loadInlineImages(
  root: string,
  paths: string[]
): Promise<{ images: InlineImage[]; lines: string[] }> {
  const images: InlineImage[] = []
  const lines: string[] = []
  const dir = boardsDir(root)
  for (const path of paths) {
    if (!isValidKanbanImagePath(path)) {
      lines.push(`- ${path} — not an attachments image path`)
      continue
    }
    const absPath = join(dir, path)
    const mimeType = IMAGE_MIME[extname(path).slice(1).toLowerCase()]
    if (mimeType === undefined) {
      lines.push(`- ${path} → ${absPath} — unsupported image format, read the file directly`)
      continue
    }
    if (images.length >= MAX_INLINE_IMAGES) {
      lines.push(`- ${path} → ${absPath} — not attached (inline image limit ${MAX_INLINE_IMAGES}), read the file directly`)
      continue
    }
    try {
      const bytes = await readFile(absPath)
      images.push({ data: bytes.toString('base64'), mimeType })
      lines.push(`- ${path} → ${absPath} (image #${images.length} below)`)
    } catch {
      lines.push(`- ${path} → ${absPath} — file not readable, read the file directly`)
    }
  }
  return { images, lines }
}

/** Блок «Images» в тексте тула: явное указание, что картинки уже в результате, плюс пути. */
function imagesSection(paths: string[], lines: string[]): string {
  if (paths.length === 0) return ''
  return (
    `\n\nImages (${paths.length}) — these files are attached to this tool result as image blocks; ` +
    `study them before starting work.\n${lines.join('\n')}`
  )
}

function commentImages(comment: KanbanComment): string[] {
  return comment.images
}

function renderComment(comment: KanbanComment): string {
  const refs: string[] = []
  if (comment.session !== undefined) refs.push(`session: ${comment.session.title} (${comment.session.id})`)
  if (comment.commits !== undefined) refs.push(`commits: ${comment.commits.map((commit) => commit.hash).join(', ')}`)
  if (comment.images.length > 0) refs.push(`images: ${comment.images.join(', ')}`)
  return `- [${comment.author} ${comment.at}] ${comment.text}${refs.length > 0 ? `\n  ${refs.join(' · ')}` : ''}`
}

/** Комментарии карточки текстом + все картинки (карточка и комментарии) inline-блоками. */
async function commentsSection(
  root: string,
  card: KanbanCard
): Promise<{ text: string; images: InlineImage[] }> {
  const paths = [...card.images, ...card.comments.flatMap(commentImages)]
  const { images, lines } = await loadInlineImages(root, paths)
  let text = ''
  if (card.comments.length > 0) {
    text = `\n\nComments (${card.comments.length}):\n${card.comments.map(renderComment).join('\n')}`
  }
  return { text: text + imagesSection(paths, lines), images }
}

interface CommentRefs {
  sessionName?: string
  commits?: { hash: string; message?: string }[]
}

function buildComment(env: KanbanToolEnv, text: string, refs: CommentRefs, images: string[]): KanbanComment {
  const comment: KanbanComment = {
    id: newKanbanId('m'),
    author: 'agent',
    text,
    images,
    at: new Date().toISOString()
  }
  const title = refs.sessionName?.trim() || env.session?.name?.trim() || ''
  if (env.session !== undefined && env.session.id.length > 0 && title.length > 0) {
    comment.session = { id: env.session.id, title }
  }
  const commits: KanbanCommitRef[] = (refs.commits ?? [])
    .filter((item) => item !== null && typeof item.hash === 'string' && item.hash.trim().length > 0)
    .map((item) => ({ hash: item.hash.trim(), message: (item.message ?? '').trim() }))
  if (commits.length > 0) comment.commits = commits
  return comment
}

function attachmentNote(copied: string[], failed: string[]): string {
  const parts: string[] = []
  if (copied.length > 0) parts.push(`Attached: ${copied.join(', ')}`)
  if (failed.length > 0) parts.push(`Failed to attach (file not found): ${failed.join(', ')}`)
  return parts.length > 0 ? `\n${parts.join('\n')}` : ''
}

export async function kanbanPickTask(env: KanbanToolEnv, args: { board?: string }): Promise<KanbanToolResult> {
  let ctx: BoardContext
  try {
    ctx = await boardContext(env, args.board)
  } catch (err) {
    return { text: errorText(err) }
  }
  try {
    const card = await pickTask(createFsStore(ctx.dir), ctx.board.id)
    if (card === null) {
      return {
        text: `No cards to pick on board "${ctx.board.name}" — columns Todo and Backlog are empty.`,
        details: { picked: false }
      }
    }
    const description = card.description.length > 0 ? `\n\nDescription:\n${card.description}` : ''
    const comments = await commentsSection(ctx.root, card)
    return {
      text:
        `Picked card ${card.id} "${card.title}" → In Progress.${description}${comments.text}\n\n` +
        `Board workflow:\n${ctx.board.workflow}`,
      details: { picked: true, cardId: card.id, title: card.title },
      images: comments.images
    }
  } catch (err) {
    return { text: errorText(err) }
  }
}

export async function kanbanListCards(
  env: KanbanToolEnv,
  args: { board?: string; column?: string; limit?: number }
): Promise<KanbanToolResult> {
  let ctx: BoardContext
  try {
    ctx = await boardContext(env, args.board)
  } catch (err) {
    return { text: errorText(err) }
  }
  const limit = Math.max(1, Math.min(Math.floor(args.limit ?? 20) || 20, 100))
  if (args.column !== undefined && args.column.trim() !== '') {
    const column = findColumn(ctx.board, args.column)
    if (column === null) {
      return { text: `Column not found: "${args.column}". Columns: ${columnNames(ctx.board)}` }
    }
    const cards = ctx.board.cards
      .filter((card) => card.columnId === column.id)
      .sort((a, b) => a.order - b.order)
      .slice(0, limit)
    const lines = cards.length > 0 ? cards.map((card) => cardLine(ctx.board, card)) : ['(empty)']
    return {
      text: `Board "${ctx.board.name}", column "${column.name}" (${cards.length}):\n${lines.join('\n')}`,
      details: { count: cards.length }
    }
  }
  const sections = ctx.board.columns.map((column) => {
    const cards = ctx.board.cards
      .filter((card) => card.columnId === column.id)
      .sort((a, b) => a.order - b.order)
    const shown = cards.slice(0, limit).map((card) => cardLine(ctx.board, card))
    const more = cards.length > shown.length ? `\n  …and ${cards.length - shown.length} more` : ''
    return `## ${column.name} (${cards.length})\n${shown.length > 0 ? shown.join('\n') + more : '(empty)'}`
  })
  return {
    text: `Board "${ctx.board.name}":\n${sections.join('\n\n')}`,
    details: { columns: ctx.board.columns.length, cards: ctx.board.cards.length }
  }
}

export async function kanbanSearch(env: KanbanToolEnv, args: { board?: string; query: string }): Promise<KanbanToolResult> {
  let ctx: BoardContext
  try {
    ctx = await boardContext(env, args.board)
  } catch (err) {
    return { text: errorText(err) }
  }
  const query = args.query.trim().toLowerCase()
  if (query.length === 0) return { text: 'Empty search query.' }
  const words = query.split(/\s+/).filter((word) => word.length > 0)
  const scored = ctx.board.cards
    .map((card) => {
      const title = card.title.toLowerCase()
      const description = card.description.toLowerCase()
      let score = 0
      if (title.includes(query)) score += 3
      if (description.includes(query)) score += 1
      for (const word of words) {
        if (title.includes(word) || description.includes(word)) score += 1
      }
      return { card, score }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
  if (scored.length === 0) {
    return { text: `No cards matching "${args.query}" on board "${ctx.board.name}".`, details: { count: 0 } }
  }
  const lines = scored.map((item) => cardLine(ctx.board, item.card))
  return {
    text: `Search "${args.query}" on board "${ctx.board.name}" (${scored.length}):\n${lines.join('\n')}`,
    details: { count: scored.length }
  }
}

export async function kanbanGetCard(env: KanbanToolEnv, args: { board?: string; id: string }): Promise<KanbanToolResult> {
  const cardId = requireCardId(args.id)
  if (cardId === null) return { text: `Invalid card id: ${args.id} (expected c-xxxxxxxx)` }
  let ctx: BoardContext
  try {
    ctx = await boardContext(env, args.board)
  } catch (err) {
    return { text: errorText(err) }
  }
  const card = ctx.board.cards.find((item) => item.id === cardId)
  if (card === undefined) return { text: `Card not found: ${cardId} on board "${ctx.board.name}".` }
  const column = ctx.board.columns.find((item) => item.id === card.columnId)
  const parts: string[] = [
    `${card.id} "${card.title}"`,
    `Column: ${column?.name ?? card.columnId}`,
    `Created: ${card.createdAt} · Updated: ${card.updatedAt}`
  ]
  parts.push(`Description:\n${card.description.length > 0 ? card.description : '(empty)'}`)
  if (card.comments.length > 0) {
    parts.push(`Comments (${card.comments.length}):\n${card.comments.map(renderComment).join('\n')}`)
  }
  const imagePaths = [...card.images, ...card.comments.flatMap(commentImages)]
  const { images, lines } = await loadInlineImages(ctx.root, imagePaths)
  const imagesText = imagesSection(imagePaths, lines).trim()
  if (imagesText.length > 0) parts.push(imagesText)
  return { text: parts.join('\n\n'), details: { cardId }, images }
}

export async function kanbanCreateCard(
  env: KanbanToolEnv,
  args: { board?: string; title: string; description?: string; column?: string }
): Promise<KanbanToolResult> {
  const title = sanitizeKanbanTitle(args.title)
  if (title === null) return { text: 'Invalid card title: must be 1–300 characters after trim.' }
  let ctx: BoardContext
  try {
    ctx = await boardContext(env, args.board)
  } catch (err) {
    return { text: errorText(err) }
  }
  let columnId: string | undefined
  if (args.column !== undefined && args.column.trim() !== '') {
    const column = findColumn(ctx.board, args.column)
    if (column === null) return { text: `Column not found: "${args.column}". Columns: ${columnNames(ctx.board)}` }
    columnId = column.id
  }
  try {
    const card = await casMutate(createFsStore(ctx.dir), ctx.board.id, (board) => {
      const next = applyCardCreate(board, { title, description: args.description, columnId })
      return { board: next, value: next.cards[next.cards.length - 1] }
    })
    if (card === null) return { text: 'Failed to create card.' }
    const column = ctx.board.columns.find((item) => item.id === card.columnId)
    return {
      text: `Created card ${card.id} "${card.title}" in column "${column?.name ?? card.columnId}" on board "${ctx.board.name}".`,
      details: { cardId: card.id, columnId: card.columnId }
    }
  } catch (err) {
    return { text: errorText(err) }
  }
}

export async function kanbanUpdateCard(
  env: KanbanToolEnv,
  args: { board?: string; id: string; title?: string; description?: string }
): Promise<KanbanToolResult> {
  const cardId = requireCardId(args.id)
  if (cardId === null) return { text: `Invalid card id: ${args.id} (expected c-xxxxxxxx)` }
  let ctx: BoardContext
  try {
    ctx = await boardContext(env, args.board)
  } catch (err) {
    return { text: errorText(err) }
  }
  try {
    const card = await casMutate(createFsStore(ctx.dir), ctx.board.id, (board) => {
      const next = applyCardUpdate(board, { id: cardId, title: args.title, description: args.description })
      return { board: next, value: next.cards.find((item) => item.id === cardId)! }
    })
    return { text: `Updated card ${cardId} "${card?.title}" on board "${ctx.board.name}".`, details: { cardId } }
  } catch (err) {
    return { text: errorText(err) }
  }
}

export async function kanbanComment(
  env: KanbanToolEnv,
  args: {
    board?: string
    id: string
    text: string
    sessionName?: string
    commits?: { hash: string; message?: string }[]
    images?: string[]
  }
): Promise<KanbanToolResult> {
  const cardId = requireCardId(args.id)
  if (cardId === null) return { text: `Invalid card id: ${args.id} (expected c-xxxxxxxx)` }
  const text = sanitizeKanbanText(args.text, KANBAN_COMMENT_MAX)
  if (text === null) return { text: `Invalid comment text: must be 1–${KANBAN_COMMENT_MAX} characters after trim.` }
  let ctx: BoardContext
  try {
    ctx = await boardContext(env, args.board)
  } catch (err) {
    return { text: errorText(err) }
  }
  const { copied, failed } = await copyAttachments(ctx.root, env.cwd, args.images)
  const comment = buildComment(env, text, args, copied)
  try {
    await casMutate(createFsStore(ctx.dir), ctx.board.id, (board) => ({
      board: applyCardComment(board, { id: cardId, comment }),
      value: true
    }))
    return {
      text: `Comment added to card ${cardId} on board "${ctx.board.name}".${attachmentNote(copied, failed)}`,
      details: { cardId, commentId: comment.id }
    }
  } catch (err) {
    return { text: errorText(err) }
  }
}

export async function kanbanMove(
  env: KanbanToolEnv,
  args: {
    board?: string
    id: string
    column: string
    comment?: string
    sessionName?: string
    commits?: { hash: string; message?: string }[]
  }
): Promise<KanbanToolResult> {
  const cardId = requireCardId(args.id)
  if (cardId === null) return { text: `Invalid card id: ${args.id} (expected c-xxxxxxxx)` }
  let ctx: BoardContext
  try {
    ctx = await boardContext(env, args.board)
  } catch (err) {
    return { text: errorText(err) }
  }
  const column = findColumn(ctx.board, args.column)
  if (column === null) return { text: `Column not found: "${args.column}". Columns: ${columnNames(ctx.board)}` }
  const commentText = sanitizeKanbanText(args.comment ?? '', KANBAN_COMMENT_MAX)
  if (args.comment !== undefined && args.comment.trim() !== '' && commentText === null) {
    return { text: `Invalid comment text: must be 1–${KANBAN_COMMENT_MAX} characters after trim.` }
  }
  try {
    const moved = await casMutate(createFsStore(ctx.dir), ctx.board.id, (board) => {
      let next = applyCardMove(board, { id: cardId, columnId: column.id })
      if (commentText !== null) {
        next = applyCardComment(next, { id: cardId, comment: buildComment(env, commentText, args, []) })
      }
      return { board: next, value: next.cards.find((item) => item.id === cardId)! }
    })
    const columnName = ctx.board.columns.find((item) => item.id === moved?.columnId)?.name ?? moved?.columnId
    return {
      text: `Card ${cardId} "${moved?.title}" moved to column "${columnName}" on board "${ctx.board.name}".` +
        (commentText !== null ? '\nComment added.' : ''),
      details: { cardId, columnId: column.id }
    }
  } catch (err) {
    return { text: errorText(err) }
  }
}

const COLUMN_ACTIONS = ['create', 'rename', 'delete', 'move'] as const

type ColumnAction = (typeof COLUMN_ACTIONS)[number]

export async function kanbanColumn(
  env: KanbanToolEnv,
  args: { board?: string; action: string; name: string; newName?: string; afterColumn?: string }
): Promise<KanbanToolResult> {
  if (!COLUMN_ACTIONS.includes(args.action as ColumnAction)) {
    return { text: `Invalid action: "${args.action}" (expected one of: ${COLUMN_ACTIONS.join(', ')})` }
  }
  const action = args.action as ColumnAction
  let ctx: BoardContext
  try {
    ctx = await boardContext(env, args.board)
  } catch (err) {
    return { text: errorText(err) }
  }
  try {
    let columnId: string
    if (action === 'create') {
      const created = await casMutate(createFsStore(ctx.dir), ctx.board.id, (board) => {
        const next = applyColumnCreate(board, args.name)
        return { board: next, value: next.columns[next.columns.length - 1] }
      })
      if (created === null) return { text: 'Failed to create column.' }
      columnId = created.id
    } else {
      const column = findColumn(ctx.board, args.name)
      if (column === null) return { text: `Column not found: "${args.name}". Columns: ${columnNames(ctx.board)}` }
      columnId = column.id
      if (action === 'rename') {
        if (args.newName === undefined || args.newName.trim() === '') return { text: 'newName is required for the rename action.' }
        await casMutate(createFsStore(ctx.dir), ctx.board.id, (board) => ({
          board: applyColumnRename(board, { id: columnId, name: args.newName! }),
          value: true
        }))
      } else if (action === 'delete') {
        await casMutate(createFsStore(ctx.dir), ctx.board.id, (board) => ({
          board: applyColumnDelete(board, columnId),
          value: true
        }))
      } else {
        let index: number
        if (args.afterColumn !== undefined && args.afterColumn.trim() !== '') {
          const after = findColumn(ctx.board, args.afterColumn)
          if (after === null) return { text: `Column not found: "${args.afterColumn}". Columns: ${columnNames(ctx.board)}` }
          index = ctx.board.columns.findIndex((item) => item.id === after.id) + 1
        } else {
          index = ctx.board.columns.length - 1
        }
        await casMutate(createFsStore(ctx.dir), ctx.board.id, (board) => ({
          board: applyColumnMove(board, { id: columnId, index }),
          value: true
        }))
      }
    }
    const updated = await readBoard(ctx.dir, ctx.board.id)
    const board = updated ?? ctx.board
    const lines = board.columns.map((column, i) => `${i + 1}. ${column.name} (${column.id})`)
    const verb = action === 'create' ? 'Created column' : action === 'rename' ? 'Renamed column' : action === 'delete' ? 'Deleted column' : 'Moved column'
    return {
      text: `${verb} "${args.name}" on board "${board.name}".\nColumns:\n${lines.join('\n')}`,
      details: { action, columnId }
    }
  } catch (err) {
    return { text: errorText(err) }
  }
}

export async function kanbanWorkflow(
  env: KanbanToolEnv,
  args: { board?: string; text?: string }
): Promise<KanbanToolResult> {
  let ctx: BoardContext
  try {
    ctx = await boardContext(env, args.board)
  } catch (err) {
    return { text: errorText(err) }
  }
  if (args.text === undefined || args.text.trim() === '') {
    return {
      text: `Workflow of board "${ctx.board.name}":\n${ctx.board.workflow}`,
      details: { workflow: ctx.board.workflow }
    }
  }
  const text = sanitizeKanbanText(args.text, KANBAN_WORKFLOW_MAX)
  if (text === null) return { text: `Invalid workflow text: must be 1–${KANBAN_WORKFLOW_MAX} characters after trim.` }
  try {
    await casMutate(createFsStore(ctx.dir), ctx.board.id, (board) => ({
      board: applyWorkflowSet(board, text),
      value: true
    }))
    return {
      text: `Workflow of board "${ctx.board.name}" updated.`,
      details: { updated: true }
    }
  } catch (err) {
    return { text: errorText(err) }
  }
}
