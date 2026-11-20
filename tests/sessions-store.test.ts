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
    expect(projectKey(project)).toBe(`native\u0000D:\\tmp\\proj`)
  })
})
