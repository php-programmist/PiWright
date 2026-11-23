import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ensureDefaultBoard, readBoard } from '../resources/kanban/lib/store'
import { resolveKanbanRoot } from '../resources/kanban/lib/root'

/** Storage-ядро расширения kanban: резолв корня через git, чтение доски, ленивая дефолтная доска. */

const dirs: string[] = []

function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

describe('resolveKanbanRoot', () => {
  it('returns cwd for a non-git directory', async () => {
    const dir = tmpDir('piwright-kanban-nogit-')
    expect(await resolveKanbanRoot(dir)).toBe(dir)
  })

  it('returns the repo root for a git repository', async () => {
    const dir = tmpDir('piwright-kanban-repo-')
    execSync('git init', { cwd: dir })
    expect(await resolveKanbanRoot(dir)).toBe(dir)
  })

  it('returns the repo root from a subdirectory', async () => {
    const dir = tmpDir('piwright-kanban-repo-')
    execSync('git init', { cwd: dir })
    const sub = join(dir, 'a', 'b')
    mkdirSync(sub, { recursive: true })
    expect(await resolveKanbanRoot(sub)).toBe(dir)
  })
})

describe('ensureDefaultBoard', () => {
  it('creates a default board with default columns and workflow', async () => {
    const root = tmpDir('piwright-kanban-lazy-')
    const board = await ensureDefaultBoard(root)
    expect(board.name).toBe('Default')
    expect(board.rev).toBe(0)
    expect(board.columns.map((c) => c.name)).toEqual(['Backlog', 'Todo', 'In Progress', 'Review', 'Done'])
    expect(board.workflow).toContain('kanban_move to Review')
    const stored = await readBoard(join(root, '.pi', 'kanban'), board.id)
    expect(stored).not.toBeNull()
    expect(stored?.id).toBe(board.id)
  })

  it('returns the existing board on the next call', async () => {
    const root = tmpDir('piwright-kanban-lazy-')
    const first = await ensureDefaultBoard(root)
    const second = await ensureDefaultBoard(root)
    expect(second.id).toBe(first.id)
  })

  it('returns the first existing board instead of creating a new one', async () => {
    const root = tmpDir('piwright-kanban-lazy-')
    await ensureDefaultBoard(root)
    const custom = { version: 1, id: 'b-00000000', name: 'A', rev: 3, workflow: '', columns: [{ id: 'col-00000000', name: 'Backlog' }], cards: [] }
    writeFileSync(join(root, '.pi', 'kanban', 'b-00000000.json'), JSON.stringify(custom), 'utf8')
    const board = await ensureDefaultBoard(root)
    expect(board.id).toBe('b-00000000')
    expect(board.name).toBe('A')
  })
})

describe('readBoard', () => {
  it('returns null for a missing file and for corrupted JSON', async () => {
    const root = tmpDir('piwright-kanban-read-')
    const dir = join(root, '.pi', 'kanban')
    mkdirSync(dir, { recursive: true })
    expect(await readBoard(dir, 'b-00000000')).toBeNull()
    writeFileSync(join(dir, 'b-00000000.json'), '{not json', 'utf8')
    expect(await readBoard(dir, 'b-00000000')).toBeNull()
  })
})
