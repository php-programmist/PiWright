import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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

  it('picks the default board by name, not by file id (same order as the UI list)', async () => {
    const root = tmpDir('piwright-kanban-order-')
    const dir = join(root, '.pi', 'kanban')
    mkdirSync(dir, { recursive: true })
    const mk = (id: string, name: string): string =>
      JSON.stringify({ version: 1, id, name, rev: 1, workflow: '', columns: [{ id: 'col-00000001', name: 'Backlog' }], cards: [] })
    writeFileSync(join(dir, 'b-00000001.json'), mk('b-00000001', 'Zeta'), 'utf8')
    writeFileSync(join(dir, 'b-00000002.json'), mk('b-00000002', 'Alpha'), 'utf8')
    const board = await ensureDefaultBoard(root)
    expect(board.id).toBe('b-00000002')
  })

  it('throws instead of creating a duplicate when only quarantined boards remain', async () => {
    const root = tmpDir('piwright-kanban-quarant-')
    const dir = join(root, '.pi', 'kanban')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'b-0000000a.json'), '{broken', 'utf8')
    expect(await readBoard(dir, 'b-0000000a')).toBeNull()
    const quarantined = readdirSync(dir).filter((name) => name.includes('.corrupt-'))
    expect(quarantined).toHaveLength(1)
    expect(existsSync(join(dir, 'b-0000000a.json'))).toBe(false)
    await expect(ensureDefaultBoard(root)).rejects.toThrow(/corrupted and quarantined/)
    expect(readdirSync(dir).some((name) => name.endsWith('.json') && !name.includes('.corrupt-'))).toBe(false)
  })

  it('leftover tmp from a killed writer does not break reads or default selection', async () => {
    const root = tmpDir('piwright-kanban-tmp-')
    const dir = join(root, '.pi', 'kanban')
    const board = await ensureDefaultBoard(root)
    writeFileSync(join(dir, `${board.id}.json.4242.deadbeef.tmp`), '{half-written', 'utf8')
    expect(await readBoard(dir, board.id)).not.toBeNull()
    expect((await ensureDefaultBoard(root)).id).toBe(board.id)
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

  it('quarantines a structurally invalid board instead of losing it silently', async () => {
    const root = tmpDir('piwright-kanban-read-')
    const dir = join(root, '.pi', 'kanban')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'b-00000001.json'), JSON.stringify({ version: 2, id: 'b-00000001' }), 'utf8')
    expect(await readBoard(dir, 'b-00000001')).toBeNull()
    const quarantined = readdirSync(dir).find((name) => name.startsWith('b-00000001.json.corrupt-'))
    expect(quarantined).toBeDefined()
    expect(existsSync(join(dir, 'b-00000001.json'))).toBe(false)
  })
})
