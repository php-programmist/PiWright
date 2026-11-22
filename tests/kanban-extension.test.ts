import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { KANBAN_EXTENSION_VERSION, installKanbanExtension } from '../src/main/pi/kanban-extension'

/** Установка расширения kanban: файлы выкладываются, маркер версии решает перезапись. */

let dir: string
const dirs: string[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'piwright-kanban-ext-'))
  dirs.push(dir)
})

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

describe('installKanbanExtension', () => {
  it('writes the extension files and the version marker', async () => {
    expect(await installKanbanExtension(dir)).toBe(dir)
    const files = readdirSync(dir, { recursive: true }).map((f) => f.toString().replace(/\\/g, '/'))
    expect(files).toContain('index.ts')
    expect(files).toContain('lib/core.ts')
    expect(files).toContain('lib/root.ts')
    expect(files).toContain('lib/store.ts')
    expect(files).toContain('lib/tools.ts')
    expect(files).toContain('.version')
    expect(readFileSync(join(dir, '.version'), 'utf8').trim()).toBe(KANBAN_EXTENSION_VERSION)
    expect(readFileSync(join(dir, 'lib/core.ts'), 'utf8')).toContain('parseKanbanBoard')
    expect(readFileSync(join(dir, 'lib/store.ts'), 'utf8')).toContain('ensureDefaultBoard')
    expect(readFileSync(join(dir, 'lib/tools.ts'), 'utf8')).toContain('kanbanPickTask')
    expect(readFileSync(join(dir, 'index.ts'), 'utf8')).toContain('kanban_pick_task')
  })

  it('skips writing when the marker matches', async () => {
    await installKanbanExtension(dir)
    writeFileSync(join(dir, 'index.ts'), 'touched')
    await installKanbanExtension(dir)
    expect(readFileSync(join(dir, 'index.ts'), 'utf8')).toBe('touched')
  })

  it('reinstalls when the marker differs', async () => {
    writeFileSync(join(dir, '.version'), 'old-version')
    writeFileSync(join(dir, 'index.ts'), 'stale')
    await installKanbanExtension(dir)
    expect(readFileSync(join(dir, 'index.ts'), 'utf8')).not.toBe('stale')
    expect(readFileSync(join(dir, '.version'), 'utf8').trim()).toBe(KANBAN_EXTENSION_VERSION)
  })
})
