import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createDefaultBoard, parseKanbanBoard, type KanbanBoard } from './core'

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
