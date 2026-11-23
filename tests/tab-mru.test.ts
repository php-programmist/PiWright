import { describe, expect, it } from 'vitest'
import { useSessionsStore } from '../src/renderer/src/stores/sessions'
import { useTabsStore, type ProjectTab } from '../src/renderer/src/stores/tabs'
import type { ProjectEntry } from '../src/shared/ipc-contracts'

/** MRU-история вкладок: при закрытии активной вкладки/сессии возврат на предыдущую
 *  активную вкладку того же проекта, а не на соседнюю слева. */

const projA: ProjectEntry = { kind: 'native', dir: 'D:\\tmp\\proj-a' }
const projB: ProjectEntry = { kind: 'native', dir: 'D:\\tmp\\proj-b' }

function session(hostId: string, project: ProjectEntry) {
  return { hostId, project, title: hostId, dot: 'idle' as const, state: 'idle', sessionId: null, sessionFile: null, telegram: false, shared: false }
}

function fileTab(path: string): ProjectTab {
  return { kind: 'file', project: projA, path }
}

describe('tabs MRU', () => {
  it('touchTab держит не более 10 записей, без дублей', () => {
    useTabsStore.setState({ mru: [], byProject: {}, activeProjectKey: null })
    for (let i = 0; i < 12; i++) useTabsStore.getState().touchTab(projA, `file\u0000f${i}`)
    const mru = useTabsStore.getState().mru
    expect(mru).toHaveLength(10)
    expect(mru[0]).toEqual({ kind: 'tab', key: expect.any(String), id: 'file\u0000f11' })
    useTabsStore.getState().touchTab(projA, 'file\u0000f11')
    const again = useTabsStore.getState().mru
    expect(again).toHaveLength(10)
    expect(again[0].kind === 'tab' && again[0].id).toBe('file\u0000f11')
  })

  it('closeTab активной вкладки возвращается на предыдущую активную вкладку проекта из MRU', () => {
    useSessionsStore.setState({ active: [], activeHostId: null, settings: null })
    useTabsStore.setState({
      activeProjectKey: 'native\u0000D:/tmp/proj-a',
      byProject: {
        'native\u0000D:/tmp/proj-a': {
          tabs: [fileTab('a.ts'), fileTab('b.ts'), fileTab('c.ts')],
          activeId: 'file\u0000c.ts'
        }
      },
      mru: [
        { kind: 'tab', key: 'native\u0000D:/tmp/proj-a', id: 'file\u0000c.ts' },
        { kind: 'tab', key: 'native\u0000D:/tmp/proj-a', id: 'file\u0000a.ts' }
      ]
    })

    useTabsStore.getState().closeTab(projA, 'file\u0000c.ts')

    const entry = useTabsStore.getState().byProject['native\u0000D:/tmp/proj-a']
    expect(entry.activeId).toBe('file\u0000a.ts')
    expect(entry.tabs.map((t) => t.path)).toEqual(['a.ts', 'b.ts'])
  })

  it('closeTab без MRU — старое поведение (сосед на месте закрытой)', () => {
    useSessionsStore.setState({ active: [], activeHostId: null, settings: null })
    useTabsStore.setState({
      activeProjectKey: 'native\u0000D:/tmp/proj-a',
      byProject: {
        'native\u0000D:/tmp/proj-a': { tabs: [fileTab('a.ts'), fileTab('b.ts')], activeId: 'file\u0000a.ts' }
      },
      mru: []
    })

    useTabsStore.getState().closeTab(projA, 'file\u0000a.ts')

    const entry = useTabsStore.getState().byProject['native\u0000D:/tmp/proj-a']
    expect(entry.activeId).toBe('file\u0000b.ts')
  })

  it('forgetHost активной сессии возвращается на предыдущую сессию того же проекта из MRU', () => {
    useSessionsStore.setState({
      active: [session('h1', projA), session('h2', projA), session('h3', projB)],
      activeHostId: 'h1',
      settings: null
    })
    useTabsStore.setState({
      activeProjectKey: null,
      byProject: {},
      mru: [
        { kind: 'session', hostId: 'h1', key: 'native\u0000D:/tmp/proj-a' },
        { kind: 'session', hostId: 'h3', key: 'native\u0000d:/tmp/proj-b' },
        { kind: 'session', hostId: 'h2', key: 'native\u0000D:/tmp/proj-a' }
      ]
    })

    useSessionsStore.getState().forgetHost('h1')

    expect(useSessionsStore.getState().activeHostId).toBe('h2')
  })

  it('forgetHost: если в MRU вкладка того же проекта — активируется вкладка', () => {
    useSessionsStore.setState({
      active: [session('h1', projA)],
      activeHostId: 'h1',
      settings: null
    })
    useTabsStore.setState({
      activeProjectKey: 'native\u0000D:/tmp/proj-a',
      byProject: {
        'native\u0000D:/tmp/proj-a': { tabs: [fileTab('a.ts')], activeId: null }
      },
      mru: [
        { kind: 'session', hostId: 'h1', key: 'native\u0000D:/tmp/proj-a' },
        { kind: 'tab', key: 'native\u0000D:/tmp/proj-a', id: 'file\u0000a.ts' }
      ]
    })

    useSessionsStore.getState().forgetHost('h1')

    const st = useSessionsStore.getState()
    expect(st.activeHostId).toBeNull()
    expect(useTabsStore.getState().byProject['native\u0000D:/tmp/proj-a'].activeId).toBe('file\u0000a.ts')
  })

  it('forgetHost без MRU — первая оставшаяся сессия того же проекта', () => {
    useSessionsStore.setState({
      active: [session('h1', projA), session('h2', projA), session('h3', projB)],
      activeHostId: 'h1',
      settings: null
    })
    useTabsStore.setState({ activeProjectKey: null, byProject: {}, mru: [] })

    useSessionsStore.getState().forgetHost('h1')

    expect(useSessionsStore.getState().activeHostId).toBe('h2')
  })

  it('forgetHost неактивной сессии не меняет активную', () => {
    useSessionsStore.setState({
      active: [session('h1', projA), session('h2', projA)],
      activeHostId: 'h1',
      settings: null
    })
    useTabsStore.setState({ activeProjectKey: null, byProject: {}, mru: [] })

    useSessionsStore.getState().forgetHost('h2')

    expect(useSessionsStore.getState().activeHostId).toBe('h1')
  })
})
