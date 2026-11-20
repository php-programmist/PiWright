import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_WINDOW_STATE, loadWindowState, sanitizeWindowState } from '../src/main/window-state'

const WORK_AREA = { width: 1920, height: 1040 }

describe('sanitizeWindowState', () => {
  it('garbage input yields defaults', () => {
    expect(sanitizeWindowState(null, WORK_AREA)).toEqual({ ...DEFAULT_WINDOW_STATE, maximized: false })
    expect(sanitizeWindowState('x', WORK_AREA)).toEqual({ ...DEFAULT_WINDOW_STATE, maximized: false })
    expect(sanitizeWindowState({ width: 'big' }, WORK_AREA)).toEqual({ ...DEFAULT_WINDOW_STATE, maximized: false })
  })

  it('valid size kept, maximized flag read', () => {
    expect(sanitizeWindowState({ width: 1280.4, height: 720, maximized: true }, WORK_AREA)).toEqual({
      width: 1280,
      height: 720,
      maximized: true
    })
  })

  it('size floored at MIN and clamped to work area', () => {
    expect(sanitizeWindowState({ width: 10, height: 50 }, WORK_AREA)).toEqual({ width: 200, height: 200, maximized: false })
    expect(sanitizeWindowState({ width: 9999, height: 9999 }, WORK_AREA)).toEqual({ width: 1920, height: 1040, maximized: false })
  })
})

describe('loadWindowState', () => {
  it('missing file yields defaults', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'piwright-winstate-'))
    expect(loadWindowState(join(dir, 'absent.json'), WORK_AREA)).toEqual({ ...DEFAULT_WINDOW_STATE, maximized: false })
  })

  it('broken json yields defaults', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'piwright-winstate-'))
    const file = join(dir, 'window-state.json')
    await fs.writeFile(file, '{oops', 'utf8')
    expect(loadWindowState(file, WORK_AREA)).toEqual({ ...DEFAULT_WINDOW_STATE, maximized: false })
  })

  it('saved state round-trips', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'piwright-winstate-'))
    const file = join(dir, 'window-state.json')
    await fs.writeFile(file, JSON.stringify({ width: 1400, height: 900, maximized: true }), 'utf8')
    expect(loadWindowState(file, WORK_AREA)).toEqual({ width: 1400, height: 900, maximized: true })
  })
})
