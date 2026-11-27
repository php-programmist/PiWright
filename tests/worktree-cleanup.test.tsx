import { describe, expect, it, vi } from 'vitest'
import { closeSessionAndSweepWorktree, stopSession } from '../src/renderer/src/lib/worktree-cleanup'
import { useSessionsStore } from '../src/renderer/src/stores/sessions'
import type { ProjectEntry, Settings } from '../src/shared/ipc-contracts'

/** Ручное закрытие сессии должно обновлять историю проекта (иначе закрытая сессия не появляется в истории). */

const project: ProjectEntry = { kind: 'native', dir: 'D:\\tmp\\proj' }
const wtProject: ProjectEntry = { kind: 'native', dir: 'D:\\tmp\\proj\\.pi\\worktrees\\wt1' }

function seedStore(active: ProjectEntry[], dot: 'idle' | 'busy' = 'idle', backgroundSessions?: boolean): void {
  useSessionsStore.setState({
    active: active.map((p, i) => ({
      hostId: `h${i + 1}`,
      project: p,
      title: 't',
      dot,
      state: dot,
      sessionId: null,
      sessionFile: null,
      telegram: false,
      shared: false,
      background: false
    })),
    projects: [{ project, history: [], historyLoading: false, showAllHistory: false }],
    settings: backgroundSessions === undefined ? null : ({ backgroundSessions } as Settings)
  })
}

describe('closeSessionAndSweepWorktree', () => {
  it('обычная вкладка закрывается с keepAlive (detach), worktree — без (kill перед удалением каталога)', async () => {
    const sessionHistory = vi.fn().mockResolvedValue([])
    const closeSession = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { piwright: { closeSession, sessionHistory } })

    seedStore([project])
    await closeSessionAndSweepWorktree('h1')
    expect(closeSession).toHaveBeenCalledWith('h1', true)
    expect(sessionHistory).toHaveBeenCalledWith(project)
    expect(useSessionsStore.getState().active).toHaveLength(0)

    seedStore([wtProject])
    await closeSessionAndSweepWorktree('h1', false)
    expect(closeSession).toHaveBeenLastCalledWith('h1', false)
    vi.unstubAllGlobals()
  })

  it('stopSession всегда останавливает процесс (keepAlive=false)', async () => {
    const sessionHistory = vi.fn().mockResolvedValue([])
    const closeSession = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { piwright: { closeSession, sessionHistory } })

    seedStore([project])
    await stopSession('h1')
    expect(closeSession).toHaveBeenCalledWith('h1', false)
    expect(sessionHistory).toHaveBeenCalledWith(project)
    expect(useSessionsStore.getState().active).toHaveLength(0)
    vi.unstubAllGlobals()
  })

  it('не-idle сессия уходит в фон: closeSession не зовётся, строка остаётся в панели', async () => {
    const sessionHistory = vi.fn().mockResolvedValue([])
    const closeSession = vi.fn().mockResolvedValue(undefined)
    const backgroundSession = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { piwright: { closeSession, sessionHistory, backgroundSession } })

    seedStore([project], 'busy', true)
    await closeSessionAndSweepWorktree('h1')
    expect(closeSession).not.toHaveBeenCalled()
    expect(backgroundSession).toHaveBeenCalledWith('h1')
    expect(sessionHistory).not.toHaveBeenCalled()
    const row = useSessionsStore.getState().active.find((r) => r.hostId === 'h1')
    expect(row?.background).toBe(true)
    vi.unstubAllGlobals()
  })

  it('не-idle сессия при выключенных фоновых сессиях закрывается с остановкой процесса, в фон не уходит', async () => {
    const sessionHistory = vi.fn().mockResolvedValue([])
    const closeSession = vi.fn().mockResolvedValue(undefined)
    const backgroundSession = vi.fn().mockResolvedValue({ ok: false, error: 'Background sessions are disabled' })
    vi.stubGlobal('window', { piwright: { closeSession, sessionHistory, backgroundSession } })

    seedStore([project], 'busy', false)
    await closeSessionAndSweepWorktree('h1')
    expect(backgroundSession).not.toHaveBeenCalled()
    expect(closeSession).toHaveBeenCalledWith('h1', true)
    expect(useSessionsStore.getState().active).toHaveLength(0)
    vi.unstubAllGlobals()
  })

  it('повторный крестик у фоновой сессии закрывает её как обычно', async () => {
    const sessionHistory = vi.fn().mockResolvedValue([])
    const closeSession = vi.fn().mockResolvedValue(undefined)
    const backgroundSession = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { piwright: { closeSession, sessionHistory, backgroundSession } })

    seedStore([project], 'busy')
    useSessionsStore.setState({
      active: useSessionsStore.getState().active.map((r) => ({ ...r, background: true }))
    })
    await closeSessionAndSweepWorktree('h1')
    expect(closeSession).toHaveBeenCalledWith('h1', true)
    expect(useSessionsStore.getState().active).toHaveLength(0)
    vi.unstubAllGlobals()
  })
})
