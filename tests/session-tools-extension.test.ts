import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { SESSION_TOOLS_EXTENSION_VERSION, installSessionToolsExtension } from '../src/main/pi/session-tools-extension'

/** Установка расширения session-tools: файлы выкладываются, маркер версии решает перезапись. */

let dir: string
const dirs: string[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'piwright-session-tools-'))
  dirs.push(dir)
})

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

describe('installSessionToolsExtension', () => {
  it('writes the extension file and the version marker', async () => {
    expect(await installSessionToolsExtension(dir)).toBe(dir)
    const files = readdirSync(dir, { recursive: true }).map((f) => f.toString().replace(/\\/g, '/'))
    expect(files).toContain('index.ts')
    expect(files).toContain('.version')
    expect(readFileSync(join(dir, '.version'), 'utf8').trim()).toBe(SESSION_TOOLS_EXTENSION_VERSION)
    expect(readFileSync(join(dir, 'index.ts'), 'utf8')).toContain('rename_session')
  })

  it('skips writing when the marker matches', async () => {
    await installSessionToolsExtension(dir)
    writeFileSync(join(dir, 'index.ts'), 'touched')
    await installSessionToolsExtension(dir)
    expect(readFileSync(join(dir, 'index.ts'), 'utf8')).toBe('touched')
  })

  it('reinstalls when the marker differs', async () => {
    writeFileSync(join(dir, '.version'), 'old-version')
    writeFileSync(join(dir, 'index.ts'), 'stale')
    await installSessionToolsExtension(dir)
    expect(readFileSync(join(dir, 'index.ts'), 'utf8')).not.toBe('stale')
    expect(readFileSync(join(dir, '.version'), 'utf8').trim()).toBe(SESSION_TOOLS_EXTENSION_VERSION)
  })
})
