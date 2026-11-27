import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SettingsService, DEFAULT_SETTINGS } from '../src/main/settings/settings'
import { projectKeyOf, projectSettingsPath } from '../src/main/settings/project-settings'

const DB_ENTRY = {
  id: 'c1',
  name: 'db',
  kind: 'postgres',
  host: 'localhost',
  port: 5432,
  database: 'app',
  user: 'u',
  authType: 'password'
}

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), 'piwright-proj-'))
}

function tempSettingsDir(): string {
  return mkdtempSync(join(tmpdir(), 'piwright-settings-'))
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

describe('ProjectSettingsStore + мигратор', () => {
  it('миграция переносит все 8 map из глобала в плоский файл проекта', () => {
    const settingsDir = tempSettingsDir()
    const projDir = tempProject()
    const file = join(settingsDir, 'settings.json')
    const pk = projectKeyOf({ kind: 'native', dir: projDir })
    writeFileSync(file, JSON.stringify({
      projects: [{ kind: 'native', dir: projDir }],
      expandedProjects: { [pk]: true },
      kanbanBoardsExpanded: { [`${pk}\u0000b1`]: true },
      kanbanColumnsCollapsed: { [`${pk}\u0000b1\u0000c1`]: true },
      kanbanCardAttention: { [pk]: { sessions: ['s1'], dismissed: ['b1\u0000card1'] } },
      terminalTabs: { [pk]: { tabs: [{ profileId: 'powershell', label: 'main' }], activeIndex: 0 } },
      projectTabs: { [pk]: { tabs: [{ kind: 'file', path: 'a.ts' }], activeIndex: 0 } },
      pinnedBranches: { [pk]: ['main', 'dev'] },
      projectDbConnections: { [pk]: [DB_ENTRY] }
    }), 'utf8')

    const service = new SettingsService(file)

    const flat = readJson(projectSettingsPath(projDir)) as Record<string, unknown>
    expect(flat['version']).toBe(1)
    expect(flat['expanded']).toBe(true)
    expect(flat['kanbanBoardsExpanded']).toEqual({ b1: true })
    expect(flat['kanbanColumnsCollapsed']).toEqual({ 'b1\u0000c1': true })
    expect(flat['kanbanCardAttention']).toEqual({ sessions: ['s1'], dismissed: ['b1\u0000card1'] })
    expect(flat['terminalTabs']).toEqual({ tabs: [{ profileId: 'powershell', label: 'main' }], activeIndex: 0 })
    expect(flat['projectTabs']).toEqual({ tabs: [{ kind: 'file', path: 'a.ts' }], activeIndex: 0 })
    expect(flat['pinnedBranches']).toEqual(['main', 'dev'])
    expect(flat['dbConnections']).toEqual([DB_ENTRY])

    const global = readJson(file)
    expect(global['expandedProjects']).toEqual({})
    expect(global['kanbanBoardsExpanded']).toEqual({})
    expect(global['kanbanColumnsCollapsed']).toEqual({})
    expect(global['kanbanCardAttention']).toEqual({})
    expect(global['terminalTabs']).toEqual({})
    expect(global['projectTabs']).toEqual({})
    expect(global['pinnedBranches']).toEqual({})
    expect(global['projectDbConnections']).toEqual({})

    const merged = service.get()
    expect(merged.expandedProjects[pk]).toBe(true)
    expect(merged.kanbanBoardsExpanded[`${pk}\u0000b1`]).toBe(true)
    expect(merged.terminalTabs[pk]).toEqual({ tabs: [{ profileId: 'powershell', label: 'main' }], activeIndex: 0 })
    expect(merged.projectDbConnections[pk]).toEqual([DB_ENTRY])

    rmSync(projDir, { recursive: true, force: true })
    rmSync(settingsDir, { recursive: true, force: true })
  })

  it('ssh-проект остаётся в глобальном файле', () => {
    const settingsDir = tempSettingsDir()
    const file = join(settingsDir, 'settings.json')
    const pk = projectKeyOf({ kind: 'ssh', dir: '/home/u/proj', serverId: 'srv' })
    writeFileSync(file, JSON.stringify({
      projects: [{ kind: 'ssh', dir: '/home/u/proj', serverId: 'srv' }],
      projectDbConnections: { [pk]: [DB_ENTRY] }
    }), 'utf8')

    const service = new SettingsService(file)
    expect(service.get().projectDbConnections[pk]).toEqual([DB_ENTRY])
    expect(readJson(file)['projectDbConnections']).toEqual({ [pk]: [DB_ENTRY] })

    rmSync(settingsDir, { recursive: true, force: true })
  })

  it('set() роутит срез проекта в файл, очистка map удаляет поле из файла', () => {
    const settingsDir = tempSettingsDir()
    const projDir = tempProject()
    const file = join(settingsDir, 'settings.json')
    const service = new SettingsService(file)
    service.set({ projects: [{ kind: 'native', dir: projDir }] })
    const pk = projectKeyOf({ kind: 'native', dir: projDir })
    const snapshot = { tabs: [{ kind: 'file' as const, path: 'b.ts' }] }

    service.set({ projectTabs: { [pk]: snapshot } })
    expect(readJson(projectSettingsPath(projDir))['projectTabs']).toEqual(snapshot)
    expect(readJson(file)['projectTabs']).toEqual({})
    expect(service.get().projectTabs[pk]).toEqual(snapshot)

    service.set({ projectTabs: {} })
    expect(readJson(projectSettingsPath(projDir))['projectTabs']).toBeUndefined()
    expect(service.get().projectTabs).toEqual({})

    rmSync(projDir, { recursive: true, force: true })
    rmSync(settingsDir, { recursive: true, force: true })
  })

  it('существующий файл проекта перекрывает глобал, недостающие поля доносятся из глобала', () => {
    const settingsDir = tempSettingsDir()
    const projDir = tempProject()
    const file = join(settingsDir, 'settings.json')
    const pk = projectKeyOf({ kind: 'native', dir: projDir })
    mkdirSync(join(projDir, '.piwright'), { recursive: true })
    writeFileSync(projectSettingsPath(projDir), JSON.stringify({ expanded: true }), 'utf8')
    writeFileSync(file, JSON.stringify({
      projects: [{ kind: 'native', dir: projDir }],
      expandedProjects: { [pk]: false },
      terminalTabs: { [pk]: { tabs: [{ profileId: 'cmd' }] } }
    }), 'utf8')

    const service = new SettingsService(file)
    expect(service.get().expandedProjects[pk]).toBe(true)
    expect(service.get().terminalTabs[pk]).toEqual({ tabs: [{ profileId: 'cmd' }] })
    const flat = readJson(projectSettingsPath(projDir))
    expect(flat['expanded']).toBe(true)
    expect(flat['terminalTabs']).toEqual({ tabs: [{ profileId: 'cmd' }] })
    expect((readJson(file)['terminalTabs'] as Record<string, unknown>)).toEqual({})

    rmSync(projDir, { recursive: true, force: true })
    rmSync(settingsDir, { recursive: true, force: true })
  })

  it('.bak проекта создаётся, exclude получает строку .piwright/', () => {
    const settingsDir = tempSettingsDir()
    const projDir = tempProject()
    const file = join(settingsDir, 'settings.json')
    mkdirSync(join(projDir, '.git'), { recursive: true })
    const service = new SettingsService(file)
    service.set({ projects: [{ kind: 'native', dir: projDir }] })
    const pk = projectKeyOf({ kind: 'native', dir: projDir })
    service.set({ pinnedBranches: { [pk]: ['main'] } })
    service.set({ pinnedBranches: { [pk]: ['main', 'dev'] } })

    expect(existsSync(`${projectSettingsPath(projDir)}.bak`)).toBe(true)
    expect((readJson(`${projectSettingsPath(projDir)}.bak`) as Record<string, unknown>)['pinnedBranches']).toEqual(['main'])
    const exclude = readFileSync(join(projDir, '.git', 'info', 'exclude'), 'utf8')
    expect(exclude.split(/\r?\n/)).toContain('.piwright/')

    rmSync(projDir, { recursive: true, force: true })
    rmSync(settingsDir, { recursive: true, force: true })
  })

  it('записи без известного native/wsl-проекта остаются в глобале', () => {
    const settingsDir = tempSettingsDir()
    const file = join(settingsDir, 'settings.json')
    const service = new SettingsService(file)
    const ghost = 'native\u0000D:/nowhere'
    service.set({ pinnedBranches: { [ghost]: ['x'] } })
    expect(service.get().pinnedBranches[ghost]).toEqual(['x'])
    expect(readJson(file)['pinnedBranches']).toEqual({ [ghost]: ['x'] })
    rmSync(settingsDir, { recursive: true, force: true })
  })

  it('недоступный каталог проекта: данные остаются в глобале и видны в get()', () => {
    const settingsDir = tempSettingsDir()
    const file = join(settingsDir, 'settings.json')
    const missing = join(tempProject(), 'gone')
    const pk = projectKeyOf({ kind: 'native', dir: missing })
    writeFileSync(file, JSON.stringify({
      projects: [{ kind: 'native', dir: missing }],
      pinnedBranches: { [pk]: ['main'] }
    }), 'utf8')

    const service = new SettingsService(file)
    expect(service.get().pinnedBranches[pk]).toEqual(['main'])
    expect((readJson(file)['pinnedBranches'] as Record<string, unknown>)[pk]).toEqual(['main'])
    rmSync(missing, { recursive: true, force: true })
    rmSync(settingsDir, { recursive: true, force: true })
  })

  it('перезапуск сервиса перечитывает файл проекта (стейт переживает рестарт)', () => {
    const settingsDir = tempSettingsDir()
    const projDir = tempProject()
    const file = join(settingsDir, 'settings.json')
    const service = new SettingsService(file)
    service.set({ projects: [{ kind: 'native', dir: projDir }] })
    const pk = projectKeyOf({ kind: 'native', dir: projDir })
    service.set({ expandedProjects: { [pk]: true }, projectTabs: { [pk]: { tabs: [{ kind: 'file', path: 'c.ts' }] } } })

    const restarted = new SettingsService(file)
    expect(restarted.get().expandedProjects[pk]).toBe(true)
    expect(restarted.get().projectTabs[pk]).toEqual({ tabs: [{ kind: 'file', path: 'c.ts' }] })
    expect(restarted.get()).not.toEqual({ ...DEFAULT_SETTINGS })

    rmSync(projDir, { recursive: true, force: true })
    rmSync(settingsDir, { recursive: true, force: true })
  })
})
