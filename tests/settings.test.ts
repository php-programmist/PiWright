import { describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsService, DEFAULT_SETTINGS, mergeExpandedProjects, mergeLoops, mergeOpenSessionTabs, mergeTerminalTabs } from '../src/main/settings/settings'

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

  it('dismissedUpdateVersion coerces non-string to null', async () => {
    const service = await tempSettings({ dismissedUpdateVersion: 42 })
    expect(service.get().dismissedUpdateVersion).toBeNull()
    const kept = await tempSettings({ dismissedUpdateVersion: '0.5.0' })
    expect(kept.get().dismissedUpdateVersion).toBe('0.5.0')
  })

  it('expandedProjects are kept from file and sanitized by mergeExpandedProjects', async () => {
    const service = await tempSettings({ expandedProjects: { 'native\u0000C:\\x': true, bad: 'nope', '': true } })
    expect(service.get().expandedProjects).toEqual({ 'native\u0000C:\\x': true })
    expect(mergeExpandedProjects({ a: false, b: 'x', c: true })).toEqual({ a: false, c: true })
    expect(mergeExpandedProjects(null)).toEqual({})
    expect(mergeExpandedProjects(['x'])).toEqual({})
  })

  it('terminalTabs are kept from file and sanitized by mergeTerminalTabs', async () => {
    const service = await tempSettings({
      terminalTabs: {
        'native\u0000C:\\x': { tabs: [{ profileId: 'powershell', label: '  Build  ' }, { profileId: 'wsl' }], activeIndex: 1 },
        bad: { tabs: [{ profileId: 'nope' }, 'x'] },
        empty: { tabs: [] },
        notabs: {}
      }
    })
    expect(service.get().terminalTabs).toEqual({
      'native\u0000C:\\x': { tabs: [{ profileId: 'powershell', label: 'Build' }, { profileId: 'wsl' }], activeIndex: 1 }
    })
    expect(mergeTerminalTabs(null)).toEqual({})
    expect(mergeTerminalTabs({ k: { tabs: [{ profileId: 'powershell' }], activeIndex: 5 } })).toEqual({
      k: { tabs: [{ profileId: 'powershell' }] }
    })
  })

  it('openSessionTabs are kept from file and sanitized by mergeOpenSessionTabs', async () => {
    const good = { project: { kind: 'native', dir: 'C:\\x' }, sessionFile: 'C:\\x\\.pi\\a.jsonl' }
    const ssh = { project: { kind: 'ssh', dir: '/home/u/api', serverId: 's1' }, sessionFile: 'b.jsonl' }
    const service = await tempSettings({
      openSessionTabs: [
        good,
        ssh,
        { project: { kind: 'nope', dir: 'C:\\y' }, sessionFile: 'c.jsonl' },
        { project: { kind: 'native' }, sessionFile: 'd.jsonl' },
        { project: good.project, sessionFile: '' },
        good,
        'junk',
        null
      ]
    })
    expect(service.get().openSessionTabs).toEqual([good, ssh])
    expect(mergeOpenSessionTabs(null)).toEqual([])
    expect(mergeOpenSessionTabs('x')).toEqual([])
  })

  it('loops are kept from file and sanitized by mergeLoops', async () => {
    const good = {
      sessionFile: 'C:\\x\\.pi\\a.jsonl',
      project: { kind: 'native', dir: 'C:\\x' },
      prompt: 'do the task',
      exitCondition: 'stop when done',
      remaining: 4,
      iteration: 2,
      baseName: 'base'
    }
    const service = await tempSettings({
      loops: [
        good,
        { ...good, sessionFile: null },
        { ...good, prompt: '' },
        { ...good, baseName: '  ' },
        { ...good, remaining: 12.5 },
        { ...good, iteration: 0 },
        { ...good, project: { kind: 'nope', dir: 'C:\\y' } },
        { ...good, project: { kind: 'native' } },
        'junk',
        null
      ]
    })
    expect(service.get().loops).toEqual([
      good,
      { ...good, sessionFile: null },
      { ...good, remaining: 0 },
      { ...good, iteration: 1 }
    ])
    expect(mergeLoops(null)).toEqual([])
    expect(mergeLoops('x')).toEqual([])
  })
})
