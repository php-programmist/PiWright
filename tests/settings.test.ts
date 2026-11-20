import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsService, DEFAULT_SETTINGS, mergeExpandedProjects } from '../src/main/settings/settings'

async function tempSettings(initial: unknown): Promise<SettingsService> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'piwright-settings-'))
  const file = join(dir, 'settings.json')
  if (initial !== null) await fs.writeFile(file, JSON.stringify(initial), 'utf8')
  return new SettingsService(file)
}

describe('SettingsService (projects + РјРёРіСЂР°С†РёСЏ)', () => {
  it('fresh file yields defaults with no projects', async () => {
    const service = await tempSettings(null)
    expect(service.get()).toEqual({ ...DEFAULT_SETTINGS })
  })

  it('theme and chatFontSize from file are kept', async () => {
    const service = await tempSettings({ theme: 'light', chatFontSize: 18 })
    expect(service.get().theme).toBe('light')
    expect(service.get().chatFontSize).toBe(18)
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

  it('legacy piPath migrates by format: Windows в†’ native, POSIX в†’ wsl', async () => {
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

  it('expandedProjects are kept from file and sanitized by mergeExpandedProjects', async () => {
    const service = await tempSettings({ expandedProjects: { 'native\u0000C:\\x': true, bad: 'nope', '': true } })
    expect(service.get().expandedProjects).toEqual({ 'native\u0000C:\\x': true })
    expect(mergeExpandedProjects({ a: false, b: 'x', c: true })).toEqual({ a: false, c: true })
    expect(mergeExpandedProjects(null)).toEqual({})
    expect(mergeExpandedProjects(['x'])).toEqual({})
  })
})
