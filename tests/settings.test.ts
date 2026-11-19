import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsService } from '../src/main/settings/settings'

async function tempSettings(initial: unknown): Promise<SettingsService> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'piwright-settings-'))
  const file = join(dir, 'settings.json')
  if (initial !== null) await fs.writeFile(file, JSON.stringify(initial), 'utf8')
  return new SettingsService(file)
}

describe('SettingsService (projects + миграция)', () => {
  it('fresh file yields defaults with no projects', async () => {
    const service = await tempSettings(null)
    expect(service.get()).toEqual({ wslDistro: '', piPathNative: '', piPathWsl: '', projects: [] })
  })

  it('legacy backend/projectDir migrate into one project', async () => {
    const service = await tempSettings({ backend: 'wsl', wslDistro: 'Ubuntu', piPath: '', projectDir: 'D:\\Work\\api' })
    expect(service.get().projects).toEqual([{ kind: 'wsl', dir: 'D:\\Work\\api' }])
  })

  it('legacy native backend migrates as native', async () => {
    const service = await tempSettings({ backend: 'native', projectDir: 'C:\\x' })
    expect(service.get().projects).toEqual([{ kind: 'native', dir: 'C:\\x' }])
  })

  it('legacy wsl backend (auto) migrates as wsl', async () => {
    const service = await tempSettings({ backend: 'auto', projectDir: 'C:\\x' })
    expect(service.get().projects).toEqual([{ kind: 'wsl', dir: 'C:\\x' }])
  })

  it('existing projects are kept as is, legacy fields ignored', async () => {
    const service = await tempSettings({
      backend: 'native',
      projectDir: 'C:\\old',
      projects: [{ kind: 'native', dir: 'C:\\new' }]
    })
    expect(service.get().projects).toEqual([{ kind: 'native', dir: 'C:\\new' }])
  })

  it('legacy piPath migrates by format: Windows → native, POSIX → wsl', async () => {
    const native = await tempSettings({ backend: 'native', piPath: 'C:\\tools\\pi.cmd', projectDir: 'C:\\x' })
    expect(native.get().piPathNative).toBe('C:\\tools\\pi.cmd')
    expect(native.get().piPathWsl).toBe('')
    const wsl = await tempSettings({ backend: 'wsl', piPath: '/usr/local/bin/pi', projectDir: 'C:\\x' })
    expect(wsl.get().piPathWsl).toBe('/usr/local/bin/pi')
    expect(wsl.get().piPathNative).toBe('')
  })

  it('set persists atomically and returns merged settings', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'piwright-settings-'))
    const file = join(dir, 'settings.json')
    const service = new SettingsService(file)
    const next = service.set({ projects: [{ kind: 'wsl', dir: '\\\\wsl.localhost\\Ubuntu\\home\\u\\proj' }], piPathWsl: '/home/u/.local/bin/pi' })
    expect(next.projects).toHaveLength(1)
    const reread = new SettingsService(file)
    expect(reread.get().projects).toEqual([{ kind: 'wsl', dir: '\\\\wsl.localhost\\Ubuntu\\home\\u\\proj' }])
    expect(reread.get().piPathWsl).toBe('/home/u/.local/bin/pi')
  })

  it('corrupted file falls back to defaults', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'piwright-settings-'))
    const file = join(dir, 'settings.json')
    await fs.writeFile(file, '{broken', 'utf8')
    const service = new SettingsService(file)
    expect(service.get().projects).toEqual([])
  })
})
