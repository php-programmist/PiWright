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
    expect(service.get()).toEqual({ wslDistro: '', piPath: '', projects: [] })
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

  it('set persists atomically and returns merged settings', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'piwright-settings-'))
    const file = join(dir, 'settings.json')
    const service = new SettingsService(file)
    const next = service.set({ projects: [{ kind: 'wsl', dir: '\\\\wsl.localhost\\Ubuntu\\home\\u\\proj' }] })
    expect(next.projects).toHaveLength(1)
    const reread = new SettingsService(file)
    expect(reread.get().projects).toEqual([{ kind: 'wsl', dir: '\\\\wsl.localhost\\Ubuntu\\home\\u\\proj' }])
  })

  it('corrupted file falls back to defaults', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'piwright-settings-'))
    const file = join(dir, 'settings.json')
    await fs.writeFile(file, '{broken', 'utf8')
    const service = new SettingsService(file)
    expect(service.get().projects).toEqual([])
  })
})
