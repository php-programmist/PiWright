import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { filterSettingsPiPath } from '../src/main/pi/backends/factory'
import { deleteSessionFile, toBackendPath } from '../src/main/sessions/session-catalog'
import type { Settings } from '../src/shared/ipc-contracts'

const SETTINGS: Settings = { wslDistro: 'Ubuntu', piPathNative: '', piPathWsl: '', piExtraArgs: '', updateUrl: '', selectorPlacement: 'top', panels: {}, projects: [] }

describe('filterSettingsPiPath', () => {
  it('empty setting yields null (auto-resolve)', () => {
    expect(filterSettingsPiPath('native', '')).toBeNull()
    expect(filterSettingsPiPath('wsl', '  ')).toBeNull()
  })

  it('wsl accepts only POSIX paths', () => {
    expect(filterSettingsPiPath('wsl', '/usr/local/bin/pi')).toBe('/usr/local/bin/pi')
    expect(filterSettingsPiPath('wsl', '~/.local/bin/pi')).toBe('~/.local/bin/pi')
    expect(filterSettingsPiPath('wsl', 'C:\\Users\\x\\.pi\\agent\\bin\\pi.cmd')).toBeNull()
  })

  it('native rejects POSIX paths', () => {
    expect(filterSettingsPiPath('native', 'C:\\Users\\x\\.pi\\agent\\bin\\pi.cmd')).toBe('C:\\Users\\x\\.pi\\agent\\bin\\pi.cmd')
    expect(filterSettingsPiPath('native', 'pi.cmd')).toBe('pi.cmd')
    expect(filterSettingsPiPath('native', '/usr/bin/pi')).toBeNull()
  })
})

describe('toBackendPath', () => {
  it('native passes through', async () => {
    expect(await toBackendPath({ kind: 'native', dir: 'C:\\p' }, SETTINGS, 'C:\\s\\a.jsonl')).toBe('C:\\s\\a.jsonl')
  })

  it('wsl UNC converts to path inside distro (no probe needed)', async () => {
    const unc = '\\\\wsl.localhost\\Ubuntu\\home\\u\\.pi\\agent\\sessions\\--home-u-p--\\a.jsonl'
    expect(await toBackendPath({ kind: 'wsl', dir: unc }, SETTINGS, unc)).toBe(
      '/home/u/.pi/agent/sessions/--home-u-p--/a.jsonl'
    )
  })

  it('wsl POSIX passes through', async () => {
    expect(await toBackendPath({ kind: 'wsl', dir: '/home/u/p' }, SETTINGS, '/home/u/p/x.jsonl')).toBe('/home/u/p/x.jsonl')
  })
})

describe('deleteSessionFile', () => {
  it('deletes a session file inside the project dir', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'piwright-del-'))
    try {
      const dir = join(root, '--tmp-p--')
      await fs.mkdir(dir, { recursive: true })
      const file = join(dir, 'a.jsonl')
      await fs.writeFile(file, 'x', 'utf8')
      const result = await deleteSessionFile(root, '/tmp/p', file)
      expect(result).toEqual({ ok: true, error: null })
      await expect(fs.stat(file)).rejects.toThrow()
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('refuses paths outside the sessions root', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'piwright-del-'))
    const outside = await fs.mkdtemp(join(tmpdir(), 'piwright-out-'))
    try {
      const result = await deleteSessionFile(root, '/tmp/p', join(outside, 'a.jsonl'))
      expect(result.ok).toBe(false)
      expect(result.error).toContain('outside')
    } finally {
      await fs.rm(root, { recursive: true, force: true })
      await fs.rm(outside, { recursive: true, force: true })
    }
  })

  it('refuses directories of other projects', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'piwright-del-'))
    try {
      const dir = join(root, '--tmp-q--')
      await fs.mkdir(dir, { recursive: true })
      const file = join(dir, 'a.jsonl')
      await fs.writeFile(file, 'x', 'utf8')
      const result = await deleteSessionFile(root, '/tmp/p', file)
      expect(result.ok).toBe(false)
      expect(result.error).toContain('belong')
      await expect(fs.stat(file)).resolves.toBeTruthy()
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  it('refuses a missing file', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'piwright-del-'))
    try {
      const result = await deleteSessionFile(root, '/tmp/p', join(root, '--tmp-p--', 'gone.jsonl'))
      expect(result.ok).toBe(false)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
