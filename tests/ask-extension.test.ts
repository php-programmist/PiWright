import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { ASK_EXTENSION_VERSION, installAskExtension } from '../src/main/pi/ask-extension'

/** Установка расширения ask_question: файлы выкладываются, маркер версии решает перезапись. */

let dir: string
const dirs: string[] = []

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'piwright-ask-ext-'))
  dirs.push(dir)
})

afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

describe('installAskExtension', () => {
  it('writes all extension files and the version marker', async () => {
    const result = await installAskExtension(dir)
    expect(result).toBe(dir)
    const files = readdirSync(dir, { recursive: true }).map((f) => f.toString().replace(/\\/g, '/'))
    for (const rel of ['index.ts', 'LICENSE', 'NOTICE', 'src/core.ts', 'src/rpc.ts', 'src/extension.ts', '.version']) {
      expect(files).toContain(rel)
    }
    expect(readFileSync(join(dir, '.version'), 'utf8').trim()).toBe(ASK_EXTENSION_VERSION)
    expect(readFileSync(join(dir, 'src', 'rpc.ts'), 'utf8')).toContain('pi-wrapper:ask:')
  })

  it('skips writing when the marker matches', async () => {
    await installAskExtension(dir)
    writeFileSync(join(dir, 'index.ts'), 'touched')
    await installAskExtension(dir)
    expect(readFileSync(join(dir, 'index.ts'), 'utf8')).toBe('touched')
  })

  it('reinstalls when the marker differs', async () => {
    writeFileSync(join(dir, '.version'), 'old-version')
    writeFileSync(join(dir, 'index.ts'), 'stale')
    await installAskExtension(dir)
    expect(readFileSync(join(dir, 'index.ts'), 'utf8')).not.toBe('stale')
    expect(readFileSync(join(dir, '.version'), 'utf8').trim()).toBe(ASK_EXTENSION_VERSION)
  })
})
