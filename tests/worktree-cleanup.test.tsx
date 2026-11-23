import { describe, expect, it, vi } from 'vitest'
import { closeSessionAndSweepWorktree } from '../src/renderer/src/lib/worktree-cleanup'
import { useSessionsStore } from '../src/renderer/src/stores/sessions'
import type { ProjectEntry } from '../src/shared/ipc-contracts'

/** Ручное закрытие сессии должно обновлять историю проекта (иначе закрытая сессия не появляется в истории). */

const project: ProjectEntry = { kind: 'native', dir: 'D:\\tmp\\proj' }

describe('closeSessionAndSweepWorktree', () => {
  it('после закрытия вызывает refreshHistory проекта', async () => {
    const sessionHistory = vi.fn().mockResolvedValue([])
    const closeSession = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('window', { piwright: { closeSession, sessionHistory } })

    useSessionsStore.setState({
      active: [{ hostId: 'h1', project, title: 't', dot: 'idle', state: 'idle', sessionId: null, sessionFile: null, telegram: false, shared: false }],
      projects: [{ project, history: [], historyLoading: false, showAllHistory: false }]
    })

    await closeSessionAndSweepWorktree('h1')

    expect(closeSession).toHaveBeenCalledWith('h1')
    expect(sessionHistory).toHaveBeenCalledWith(project)
    expect(useSessionsStore.getState().active).toHaveLength(0)
    vi.unstubAllGlobals()
  })
})
