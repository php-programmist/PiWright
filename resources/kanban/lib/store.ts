import { mkdir, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
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

const LOCK_TIMEOUT_MS = 10_000
const LOCK_STALE_MS = 30_000

/** Кросс-процессная блокировка файла доски на время rev-check + записи: main-процесс и
 *  pi-агент пишут одну доску независимо, check-then-write без лока теряет апдейты и
 *  рвёт JSON. Ловушка через 'wx' (EEXIST если занято); зависший лок (краш писателя)
 *  снимается по возрасту. */
async function withBoardLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const lockFile = `${file}.lock`
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  for (;;) {
    let handle: FileHandle
    try {
      handle = await open(lockFile, 'wx')
    } catch (err) {
      // EPERM: Windows оставляет только что удалённое имя в pending-delete — это «занято», не фатально.
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'EEXIST' && code !== 'EPERM') throw err
      if (code === 'EEXIST') {
        try {
          const st = await stat(lockFile)
          if (Date.now() - st.mtimeMs > LOCK_STALE_MS) {
            await rm(lockFile, { force: true }).catch(() => {})
            continue
          }
        } catch {
          continue
        }
      }
      if (Date.now() > deadline) throw new Error(`Kanban board file is locked: ${lockFile}`)
      await new Promise((resolve) => setTimeout(resolve, 25 + Math.random() * 75))
      continue
    }
    try {
      await handle.writeFile(String(process.pid))
    } finally {
      await handle.close()
    }
    try {
      return await fn()
    } finally {
      await rm(lockFile, { force: true }).catch(() => {})
    }
  }
}

const RENAME_RETRY_MAX = 20

/** Уникальный tmp на запись + fsync + rename; при ошибке tmp подчищается. Общий детерминированный
 *  tmp двух писателей = переименование недописанного файла = битый JSON. fsync до rename: rename
 *  атомарен для читателя, но без сброса на диск краш процесса/питания оставляет недописанный tmp.
 *  EPERM/EBUSY на rename (антивирус, индексатор, 9P) — transient, ретраится с бэкоффом. */
async function atomicWrite(file: string, data: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`
  try {
    const handle = await open(tmp, 'w')
    try {
      await handle.writeFile(data, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    for (let attempt = 0; ; attempt += 1) {
      try {
        await rename(tmp, file)
        break
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if ((code !== 'EPERM' && code !== 'EBUSY') || attempt >= RENAME_RETRY_MAX) throw err
        await new Promise((resolve) => setTimeout(resolve, 25 + attempt * 5))
      }
    }
  } catch (err) {
    await rm(tmp, { force: true })
    throw err
  }
}

const CORRUPT_MARK = '.corrupt-'

/** Битый файл доски → `<board>.json.corrupt-<rev>-<ts>.json`: данные сохранены для разбора,
 *  листинги досок такой файл игнорируют. */
async function quarantineBoardFile(file: string, text: string): Promise<void> {
  const rev = /"rev"\s*:\s*(\d+)/.exec(text)?.[1] ?? 'x'
  await rename(file, `${file}${CORRUPT_MARK}${rev}-${Date.now()}.json`).catch(() => {})
}

/** Доска из файла; нет файла — null; битый JSON — quarantine + null (молчаливая потеря
 *  доски недопустима, файл остаётся на диске для восстановления). */
export async function readBoard(dir: string, boardId: string): Promise<KanbanBoard | null> {
  let text: string
  try {
    text = await readFile(boardFile(dir, boardId), 'utf8')
  } catch {
    return null
  }
  let board: KanbanBoard | null = null
  try {
    board = parseKanbanBoard(JSON.parse(text))
  } catch {
    board = null
  }
  if (board === null) await quarantineBoardFile(boardFile(dir, boardId), text)
  return board
}

/** Ленивая дефолтная доска: первая существующая по имени (та же сортировка, что в listBoards
 *  UI — иначе агент и UI при двух досках брали разные), иначе создание «Default» с дефолтными
 *  колонками и workflow. Вызов тулом или UI создаёт доску при первом обращении — в неиспользуемых
 *  проектах никакого мусора. Валидных досок нет, но есть quarantine-файлы — явная ошибка вместо
 *  молчаливого дубля. */
export async function ensureDefaultBoard(root: string): Promise<KanbanBoard> {
  const dir = boardsDir(root)
  let entries: string[] = []
  try {
    entries = await readdir(dir)
  } catch {
    // каталога досок ещё нет — создаём дефолтную
  }
  const boards: KanbanBoard[] = []
  for (const name of entries) {
    if (!name.endsWith('.json') || name.includes(CORRUPT_MARK)) continue
    const board = await readBoard(dir, name.slice(0, -'.json'.length))
    if (board !== null) boards.push(board)
  }
  if (boards.length > 0) {
    boards.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    return boards[0]
  }
  let corrupt: string[] = []
  try {
    corrupt = (await readdir(dir)).filter((name) => name.includes(CORRUPT_MARK))
  } catch {
    // каталога досок нет
  }
  if (corrupt.length > 0) {
    throw new Error(
      `Kanban board file(s) corrupted and quarantined: ${corrupt.join(', ')}. Restore or delete them before creating a default board.`
    )
  }
  const board = createDefaultBoard()
  await mkdir(dir, { recursive: true })
  await atomicWrite(boardFile(dir, board.id), JSON.stringify(board, null, 2))
  return board
}

/** CAS-стор досок (та же семантика, что в main KanbanService): write проверяет rev на диске
 *  и бросает KanbanConflictError при устаревшей доске. */
export function createFsStore(dir: string): KanbanBoardStore {
  return {
    read: async (boardId) => await readBoard(dir, boardId),
    write: async (board) => {
      const file = boardFile(dir, board.id)
      await withBoardLock(file, async () => {
        let currentRev: number | null = null
        try {
          const parsed = parseKanbanBoard(JSON.parse(await readFile(file, 'utf8')))
          if (parsed !== null) currentRev = parsed.rev
        } catch {
          // Файла нет — первая запись.
        }
        if (currentRev !== null && currentRev !== board.rev - 1) throw new KanbanConflictError()
        await mkdir(dir, { recursive: true })
        await atomicWrite(file, JSON.stringify(board, null, 2))
      })
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
    names = (await readdir(dir)).filter((name) => name.endsWith('.json') && !name.includes(CORRUPT_MARK))
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
