import { describe, expect, it, vi, beforeEach } from 'vitest'
import { setTerminalTabs } from '../src/shared/terminal-tabs'
import { useTerminalStore } from '../src/renderer/src/stores/terminal'
import { useSessionsStore } from '../src/renderer/src/stores/sessions'
import type { ProjectEntry, Settings, TerminalTabsSnapshot } from '../src/shared/ipc-contracts'

/** Фича 37: переименование вкладок терминала + персист/восстановление через settings.terminalTabs. */

const project: ProjectEntry = { kind: 'native', dir: 'D:\\tmp\\proj' }
const key = `native\u0000D:/tmp/proj`
const wtProject: ProjectEntry = { kind: 'native', dir: 'D:\\tmp\\proj\\.pi\\worktrees\\wt1' }

const baseSettings: Settings = {
  wslDistro: '',
  piPathNative: '',
  piPathWsl: '',
  piExtraArgs: '',
  updateUrl: '',
  selectorPlacement: 'top',
  theme: 'dark',
  chatFontSize: 14,
  sendOnEnter: false,
  loopsEnabled: false,
  loopCloseSession: false,
  kanbanEnabled: false,
  kanbanTheme: 'slate',
  language: 'en',
  panels: {},
  expandedProjects: {},
  kanbanBoardsExpanded: {},
  kanbanColumnsCollapsed: {},
  kanbanCardAttention: {},
  terminalTabs: {},
  projectTabs: {},
  pinnedBranches: {},
  dismissedUpdateVersion: null,
  lastProjectKey: null,
  lastModel: null,
  lastThinkingLevel: null,
  notifications: {
    sounds: { completion: '', await: '', error: '' },
    telegram: { chatId: '', events: { turnEnd: true, permission: true, question: true, error: true, loopEnd: false } },
    remote: { enabled: false, port: 7690, staticPin: '' }
  },
  projects: []
}

function seedState(settings: Settings | null): void {
  useSessionsStore.setState({ settings })
  useTerminalStore.setState({ open: true, projectKey: key, projects: {}, terms: {}, error: null })
}

describe('setTerminalTabs (shared merge)', () => {
  it('добавляет снимок не мутируя настройки', () => {
    const snapshot: TerminalTabsSnapshot = { tabs: [{ profileId: 'powershell', label: 'Build' }], activeIndex: 0 }
    const patch = setTerminalTabs(baseSettings, key, snapshot)
    expect(patch.terminalTabs?.[key]).toEqual(snapshot)
    expect(baseSettings.terminalTabs).toEqual({})
  })
})

describe('terminal store rename + persist', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('rename ставит customLabel и пишет снимок в настройки', async () => {
    const setSettings = vi.fn().mockImplementation((patch: Partial<Settings>) => Promise.resolve({ ...baseSettings, ...patch }))
    vi.stubGlobal('window', { piwright: { setSettings } })
    seedState(baseSettings)
    useTerminalStore.setState({
      terms: { t1: { id: 't1', profileId: 'powershell', label: 'PowerShell', dead: false } },
      projects: { [key]: { ids: ['t1'], activeId: 't1' } }
    })

    useTerminalStore.getState().rename('t1', '  Build  ')
    expect(useTerminalStore.getState().terms['t1']?.customLabel).toBe('Build')
    expect(setSettings).toHaveBeenCalledTimes(1)
    const patch = setSettings.mock.calls[0][0] as Partial<Settings>
    expect(patch.terminalTabs?.[key]).toEqual({ tabs: [{ profileId: 'powershell', label: 'Build' }], activeIndex: 0 })

    useTerminalStore.getState().rename('t1', '   ')
    expect(useTerminalStore.getState().terms['t1']?.customLabel).toBeUndefined()
    vi.unstubAllGlobals()
  })

  it('ensureTabs восстанавливает сохранённые вкладки с именами и активной', async () => {
    const termCreate = vi.fn().mockImplementation((_p, profileId) =>
      Promise.resolve({ ok: true, error: null, terminal: { id: `new-${profileId}`, profileId, label: 'PowerShell' } })
    )
    const setSettings = vi.fn().mockResolvedValue(baseSettings)
    vi.stubGlobal('window', { piwright: { termCreate, setSettings } })
    seedState({
      ...baseSettings,
      terminalTabs: {
        [key]: { tabs: [{ profileId: 'powershell', label: 'Build' }, { profileId: 'wsl' }], activeIndex: 1 }
      }
    })

    await useTerminalStore.getState().ensureTabs(project)
    await vi.waitFor(() => {
      expect(useTerminalStore.getState().projects[key]?.ids).toEqual(['new-powershell', 'new-wsl'])
    })
    expect(useTerminalStore.getState().terms['new-powershell']?.customLabel).toBe('Build')
    expect(useTerminalStore.getState().projects[key]?.activeId).toBe('new-wsl')
    // восстановление не перезаписывает настройки
    expect(setSettings).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('ensureTabs без сохранённых вкладок создаёт дефолтную (фича 36)', async () => {
    const termCreate = vi
      .fn()
      .mockResolvedValue({ ok: true, error: null, terminal: { id: 'd1', profileId: 'powershell', label: 'PowerShell' } })
    vi.stubGlobal('window', { piwright: { termCreate, setSettings: vi.fn().mockResolvedValue(baseSettings) } })
    seedState(baseSettings)

    await useTerminalStore.getState().ensureTabs(project)
    await vi.waitFor(() => {
      expect(useTerminalStore.getState().projects[key]?.ids).toEqual(['d1'])
    })
    vi.unstubAllGlobals()
  })

  it('терминал worktree-сесси лежит в наборе родительского проекта (один док на проект)', async () => {
    const termCreate = vi
      .fn()
      .mockResolvedValue({ ok: true, error: null, terminal: { id: 'w1', profileId: 'powershell', label: 'PowerShell' } })
    vi.stubGlobal('window', { piwright: { termCreate, termProfiles: vi.fn().mockResolvedValue({ ok: true, profiles: [], defaultProfileId: 'powershell' }), setSettings: vi.fn().mockResolvedValue(baseSettings) } })
    useSessionsStore.setState({ settings: baseSettings })
    useTerminalStore.setState({ open: true, projectKey: null, projects: {}, terms: {}, error: null })
    useTerminalStore.getState().setProject(wtProject)

    await vi.waitFor(() => {
      expect(useTerminalStore.getState().projects[key]?.ids).toEqual(['w1'])
    })
    expect(useTerminalStore.getState().projectKey).toBe(key)
    vi.unstubAllGlobals()
  })

  it('spawn при reject IPC показывает ошибку и не создаёт вкладку', async () => {
    const termCreate = vi.fn().mockRejectedValue(new Error('spawn ENOENT'))
    vi.stubGlobal('window', { piwright: { termCreate, setSettings: vi.fn().mockResolvedValue(baseSettings) } })
    seedState(baseSettings)

    const id = await useTerminalStore.getState().spawn(project)
    expect(id).toBeNull()
    expect(useTerminalStore.getState().error).toBe('spawn ENOENT')
    expect(useTerminalStore.getState().projects[key]).toBeUndefined()
    vi.unstubAllGlobals()
  })

  it('close убирает вкладку из снимка, пустой проект — ключ удаляется', async () => {
    const termClose = vi.fn().mockResolvedValue({ ok: true, error: null })
    const savedTabs = { [key]: { tabs: [{ profileId: 'powershell' as const }], activeIndex: 0 } }
    const setSettings = vi
      .fn()
      .mockImplementation((patch: Partial<Settings>) => Promise.resolve({ ...baseSettings, ...patch }))
    vi.stubGlobal('window', { piwright: { termClose, setSettings } })
    seedState({ ...baseSettings, terminalTabs: savedTabs })
    useTerminalStore.setState({
      terms: { t1: { id: 't1', profileId: 'powershell', label: 'PowerShell', dead: false } },
      projects: { [key]: { ids: ['t1'], activeId: 't1' } }
    })

    await useTerminalStore.getState().close('t1')
    const patch = setSettings.mock.calls.at(-1)?.[0] as Partial<Settings>
    expect(patch.terminalTabs?.[key]).toBeUndefined()
    expect(useTerminalStore.getState().projects[key]?.ids).toEqual([])
    vi.unstubAllGlobals()
  })
})
