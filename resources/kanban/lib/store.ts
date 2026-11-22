import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  createDefaultBoard,
  isValidKanbanId,
  KanbanConflictError,
  parseKanbanBoard,
  type KanbanBoard,
  type KanbanBoardStore
} from './core'

export function boardsDir(root: string): string {
  return join(root, '.pi', 'kanban')
}

export function boardFile(dir: string, boardId: string): string {
  return join(dir, `${boardId}.json`)
}

/** Доска из файла; нет файла или битый JSON — null. */
export async function readBoard(dir: string, boardId: string): Promise<KanbanBoard | null> {
  let text: string
  try {
    text = await readFile(boardFile(dir, boardId), 'utf8')
  } catch {
    return null
  }
  try {
    return parseKanbanBoard(JSON.parse(text))
  } catch {
    return null
  }
}

/** Ленивая дефолтная доска: первая существующая (по имени файла), иначе создание «Default»
 *  с дефолтными колонками и workflow. Вызов тулом или UI создаёт доску при первом обращении —
 *  в неиспользуемых проектах никакого мусора. */
export async function ensureDefaultBoard(root: string): Promise<KanbanBoard> {
  const dir = boardsDir(root)
  let names: string[] = []
  try {
    names = (await readdir(dir))
      .filter((name) => name.endsWith('.json') && !name.endsWith('.tmp.json'))
      .sort()
  } catch {
    // каталога досок ещё нет — создаём дефолтную
  }
  for (const name of names) {
    const board = await readBoard(dir, name.slice(0, -'.json'.length))
    if (board !== null) return board
  }
  const board = createDefaultBoard()
  await mkdir(dir, { recursive: true })
  const tmp = `${boardFile(dir, board.id)}.tmp`
  await writeFile(tmp, JSON.stringify(board, null, 2), 'utf8')
  await rename(tmp, boardFile(dir, board.id))
  return board
}

/** CAS-стор досок (та же семантика, что в main KanbanService): write проверяет rev на диске
 *  и бросает KanbanConflictError при устаревшей доске. */
export function createFsStore(dir: string): KanbanBoardStore {
  return {
    read: async (boardId) => await readBoard(dir, boardId),
    write: async (board) => {
      const file = boardFile(dir, board.id)
      let currentRev: number | null = null
      try {
        const parsed = parseKanbanBoard(JSON.parse(await readFile(file, 'utf8')))
        if (parsed !== null) currentRev = parsed.rev
      } catch {
        // Файла нет — первая запись.
      }
      if (currentRev !== null && currentRev !== board.rev - 1) throw new KanbanConflictError()
      await mkdir(dir, { recursive: true })
      const tmp = `${file}.tmp`
      await writeFile(tmp, JSON.stringify(board, null, 2), 'utf8')
      await rename(tmp, file)
    }
  }
}

/** Доска по параметру тула: id (b-xxxxxxxx), имя (без учёта регистра) или дефолтная.
 *  Не найдена — Error с перечнем существующих. */
export async function findBoard(root: string, boardParam?: string): Promise<KanbanBoard> {
  if (boardParam === undefined || boardParam.trim() === '') return await ensureDefaultBoard(root)
  const param = boardParam.trim()
  const dir = boardsDir(root)
  if (param.startsWith('b-') && isValidKanbanId(param, 'b')) {
    const board = await readBoard(dir, param)
    if (board === null) throw new Error(`Board not found: ${param}`)
    return board
  }
  const needle = param.toLowerCase()
  let names: string[] = []
  try {
    names = (await readdir(dir)).filter((name) => name.endsWith('.json') && !name.endsWith('.tmp.json'))
  } catch {
    // каталога досок ещё нет
  }
  for (const name of names) {
    const board = await readBoard(dir, name.slice(0, -'.json'.length))
    if (board !== null && board.name.toLowerCase() === needle) return board
  }
  const existing = names.map((name) => name.slice(0, -'.json'.length)).join(', ')
  throw new Error(`Board not found: ${param}${existing.length > 0 ? ` (existing: ${existing})` : ''}`)
}
