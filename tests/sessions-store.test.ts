import { beforeEach, describe, expect, it, vi } from 'vitest'
import { projectKey, useSessionsStore } from '../src/renderer/src/stores/sessions'
import type { ProjectEntry, SessionSummary } from '../src/shared/ipc-contracts'

/** refreshHistory: первая загрузка с лоадером, повторная — тихая (список не дёргается). */

const project: ProjectEntry = { kind: 'native', dir: 'D:\\tmp\\proj' }

function summary(id: string, parent: string | null = null): SessionSummary {
  return { id, title: id, lastActivityEpochMs: 0, cwd: 'D:\\tmp\\proj', path: `C:/s/${id}.jsonl`, parentSession: parent }
}

function seedProject(history: SessionSummary[]): void {
  useSessionsStore.setState({
    projects: [{ project, history, historyLoading: false, showAllHistory: false }]
  })
}

describe('sessions store refreshHistory', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('первая загрузка ставит historyLoading, повторная — тихая', async () => {
    const first = [summary('a')]
    const second = [summary('a'), summary('b')]
    const sessionHistory = vi.fn().mockResolvedValue(first)
    vi.stubGlobal('window', { piwright: { sessionHistory } })

    seedProject([])
    await useSessionsStore.getState().refreshHistory(project)
    expect(sessionHistory).toHaveBeenCalledTimes(1)
    expect(useSessionsStore.getState().projects[0]).toMatchObject({ history: first, historyLoading: false })

    sessionHistory.mockResolvedValue(second)
    await useSessionsStore.getState().refreshHistory(project)
    expect(sessionHistory).toHaveBeenCalledTimes(2)
    const row = useSessionsStore.getState().projects[0]
    expect(row.history).toEqual(second)
    expect(row.historyLoading).toBe(false)
    vi.unstubAllGlobals()
  })

  it('historyLoading не мигает между тихими обновлениями', async () => {
    let resolveHistory: (h: SessionSummary[]) => void = () => {}
    const sessionHistory = vi.fn().mockImplementation(() => new Promise<SessionSummary[]>((resolve) => { resolveHistory = resolve }))
    vi.stubGlobal('window', { piwright: { sessionHistory } })

    seedProject([summary('a')])
    const promise = useSessionsStore.getState().refreshHistory(project)
    expect(useSessionsStore.getState().projects[0].historyLoading).toBe(false)
    resolveHistory([summary('a')])
    await promise
    vi.unstubAllGlobals()
  })

  it('ключ проекта стабильный', () => {
    expect(projectKey(project)).toBe(`native\u0000D:/tmp/proj`)
  })

  it('applyStatus: флаг из статуса побеждает локальный (петля копирует флаги в main)', () => {
    useSessionsStore.setState({ active: [{ hostId: 'h1', project, title: 't', dot: 'idle', state: 'idle', sessionId: null, sessionFile: null, telegram: false, shared: false }] })
    useSessionsStore.getState().applyStatus({ hostId: 'h1', state: 'idle', backend: null, model: null, sessionId: null, sessionFile: null, error: null, models: [], thinkingLevels: [], thinkingLevel: null, project, title: 't', dot: 'idle', telegram: true, shared: true })
    expect(useSessionsStore.getState().active[0]).toMatchObject({ telegram: true, shared: true })
  })

  it('applyStatus: без флагов в статусе локальные сохраняются (optimistic toggle)', () => {
    useSessionsStore.setState({ active: [{ hostId: 'h2', project, title: 't', dot: 'idle', state: 'idle', sessionId: null, sessionFile: null, telegram: true, shared: false }] })
    useSessionsStore.getState().applyStatus({ hostId: 'h2', state: 'idle', backend: null, model: null, sessionId: null, sessionFile: null, error: null, models: [], thinkingLevels: [], thinkingLevel: null, project, title: 't', dot: 'idle' })
    expect(useSessionsStore.getState().active[0]).toMatchObject({ telegram: true, shared: false })
  })
})
