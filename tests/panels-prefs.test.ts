/** Панели git/files/terminal: hydrate наводит эксклюзивность git/files (обе открыты → git),
 *  persist сериализуется — быстрые тогглы не теряют патчи друг друга (баг 9). */
import { describe, expect, it, vi } from 'vitest'
import { hydratePanels, persistPanel } from '../src/renderer/src/stores/panels-prefs'
import { useGitStore } from '../src/renderer/src/stores/git'
import { useFilesStore } from '../src/renderer/src/stores/files'
import { useKanbanStore } from '../src/renderer/src/stores/kanban'
import { useDbStore } from '../src/renderer/src/stores/db'
import { useSessionsStore } from '../src/renderer/src/stores/sessions'
import type { PanelPrefs, Settings } from '../src/shared/ipc-contracts'

function settingsWith(panels: { git?: PanelPrefs; files?: PanelPrefs; terminal?: PanelPrefs; kanban?: PanelPrefs; db?: PanelPrefs }): Settings {
  return { panels } as unknown as Settings
}

describe('panels prefs', () => {
  it('hydrate оставляет открытой только git, если в настройках открыты обе', async () => {
    const setSettings = vi.fn().mockImplementation(async (patch: Settings) => patch)
    vi.stubGlobal('window', { piwright: { setSettings } })
    useSessionsStore.setState({ settings: settingsWith({ git: { open: true }, files: { open: true } }) })
    const saved = settingsWith({ git: { open: true }, files: { open: true } })
    hydratePanels(saved)
    expect(useGitStore.getState().open).toBe(true)
    expect(useFilesStore.getState().open).toBe(false)
    await vi.waitFor(() => expect(setSettings).toHaveBeenCalledTimes(1))
    const patch = setSettings.mock.calls[0][0] as Settings
    expect(patch.panels?.files).toMatchObject({ open: false })
    vi.unstubAllGlobals()
  })

  it('hydrate не трогает панели, когда открыта одна', () => {
    vi.stubGlobal('window', { piwright: { setSettings: vi.fn() } })
    useGitStore.setState({ open: false })
    useFilesStore.setState({ open: false })
    hydratePanels(settingsWith({ git: { open: true }, files: { open: false } }))
    expect(useGitStore.getState().open).toBe(true)
    expect(useFilesStore.getState().open).toBe(false)
    vi.unstubAllGlobals()
  })

  it('быстрые persist не перетирают патчи: вторая запись строится от результата первой', async () => {
    const setSettings = vi.fn().mockImplementation(async (patch: Settings) => patch)
    vi.stubGlobal('window', { piwright: { setSettings } })
    useSessionsStore.setState({ settings: settingsWith({ git: { open: false }, files: { open: false } }) })
    persistPanel('git', { open: true })
    persistPanel('files', { open: true })
    await vi.waitFor(() => expect(setSettings).toHaveBeenCalledTimes(2))
    const second = setSettings.mock.calls[1][0] as Settings
    expect(second.panels?.git).toMatchObject({ open: true })
    expect(second.panels?.files).toMatchObject({ open: true })
    vi.unstubAllGlobals()
  })

  it('hydrate: db открыта в настройках — вытесняет git/files/kanban', async () => {
    const setSettings = vi.fn().mockImplementation(async (patch: Settings) => patch)
    vi.stubGlobal('window', { piwright: { setSettings } })
    useGitStore.setState({ open: true })
    useFilesStore.setState({ open: false })
    useKanbanStore.setState({ open: true })
    useDbStore.setState({ open: true })
    hydratePanels(settingsWith({ git: { open: true }, kanban: { open: true }, db: { open: true } }))
    expect(useDbStore.getState().open).toBe(true)
    expect(useGitStore.getState().open).toBe(false)
    expect(useKanbanStore.getState().open).toBe(false)
    await vi.waitFor(() => expect(setSettings.mock.calls.length).toBeGreaterThanOrEqual(2))
    const patches = setSettings.mock.calls.map((c) => (c[0] as Settings).panels)
    expect(patches.some((p) => p?.git?.open === false)).toBe(true)
    expect(patches.some((p) => p?.kanban?.open === false)).toBe(true)
    vi.unstubAllGlobals()
  })
})
