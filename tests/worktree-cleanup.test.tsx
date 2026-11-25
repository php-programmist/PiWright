import { describe, expect, it, vi } from 'vitest'
import { closeSessionAndSweepWorktree, stopSession } from '../src/renderer/src/lib/worktree-cleanup'
import { useSessionsStore } from '../src/renderer/src/stores/sessions'
import type { ProjectEntry } from '../src/shared/ipc-contracts'

/** Ручное закрытие сессии должно обновлять историю проекта (иначе закрытая сессия не появляется в истории). */

const project: ProjectEntry = { kind: 'native', dir: 'D:\\tmp\\proj' }
const wtProject: ProjectEntry = { kind: 'native', dir: 'D:\\tmp\\proj\\.pi\\worktrees\\wt1' }

function seedStore(active: ProjectEntry[]): void {
  useSessionsStore.setState({
    active: active.map((p, i) => ({
      hostId: `h${i + 1}`,
      project: p,
      title: 't',
      dot: 'idle' as const,
      state: 'idle',
      sessionId: null,
      sessionFile: null,
      telegram: false,
      shared: false
    })),
    projects: [{ project, history: [], historyLoading: false, showAllHistory: false }]
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
})
