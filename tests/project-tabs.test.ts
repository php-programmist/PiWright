import { describe, expect, it } from 'vitest'
import { mergeProjectTabs } from '../src/shared/project-tabs'

describe('mergeProjectTabs — kanban', () => {
  it('сохраняет kanban-вкладку с boardId и title', () => {
    const out = mergeProjectTabs({
      'dir\u0000D:\\proj': {
        tabs: [
          { kind: 'kanban', boardId: 'b-1a2b3c4d', title: 'Default' },
          { kind: 'file', path: 'src/a.ts' }
        ],
        activeIndex: 0
      }
    })
    const snap = out['dir\u0000D:\\proj']
    expect(snap).toBeDefined()
    expect(snap.tabs[0]).toEqual({ kind: 'kanban', boardId: 'b-1a2b3c4d', title: 'Default' })
    expect(snap.activeIndex).toBe(0)
  })

  it('отбрасывает kanban-вкладку без boardId, нестроковые поля срезает', () => {
    const out = mergeProjectTabs({
      k: {
        tabs: [
          { kind: 'kanban' },
          { kind: 'kanban', boardId: 42 },
          { kind: 'kanban', boardId: 'b-1a2b3c4d', title: 5 }
        ]
      }
    })
    expect(out['k']?.tabs).toEqual([{ kind: 'kanban', boardId: 'b-1a2b3c4d' }])
  })

  it('незнакомый kind отбрасывается', () => {
    const out = mergeProjectTabs({ k: { tabs: [{ kind: 'kanban2', boardId: 'b-1a2b3c4d' }] } })
    expect(out['k']).toBeUndefined()
  })

  it('сохраняет task-вкладку с boardId, taskId и title', () => {
    const out = mergeProjectTabs({
      'dir\u0000D:\\proj': {
        tabs: [{ kind: 'task', boardId: 'b-1a2b3c4d', taskId: 'c-9249e685', title: 'Fix bug' }],
        activeIndex: 0
      }
    })
    const snap = out['dir\u0000D:\\proj']
    expect(snap).toBeDefined()
    expect(snap.tabs[0]).toEqual({ kind: 'task', boardId: 'b-1a2b3c4d', taskId: 'c-9249e685', title: 'Fix bug' })
  })

  it('отбрасывает task-вкладку без boardId или taskId', () => {
    const out = mergeProjectTabs({
      k: {
        tabs: [
          { kind: 'task', taskId: 'c-9249e685' },
          { kind: 'task', boardId: 'b-1a2b3c4d' },
          { kind: 'task', boardId: 'b-1a2b3c4d', taskId: 'c-9249e685' }
        ]
      }
    })
    expect(out['k']?.tabs).toEqual([{ kind: 'task', boardId: 'b-1a2b3c4d', taskId: 'c-9249e685' }])
  })

  it('сохраняет db-table-вкладку с connectionId, schema и table', () => {
    const out = mergeProjectTabs({
      k: {
        tabs: [{ kind: 'db-table', connectionId: 'db-abc', schema: 'public', table: 'users', title: 'public.users' }],
        activeIndex: 0
      }
    })
    expect(out['k']?.tabs).toEqual([
      { kind: 'db-table', connectionId: 'db-abc', schema: 'public', table: 'users', title: 'public.users' }
    ])
    expect(out['k']?.activeIndex).toBe(0)
  })

  it('отбрасывает db-table-вкладку без connectionId/schema/table', () => {
    const out = mergeProjectTabs({
      k: {
        tabs: [
          { kind: 'db-table', schema: 'public', table: 'users' },
          { kind: 'db-table', connectionId: 'db-abc', table: 'users' },
          { kind: 'db-table', connectionId: 'db-abc', schema: 'public' },
          { kind: 'db-table', connectionId: 'db-abc', schema: 'public', table: 'users' }
        ]
      }
    })
    expect(out['k']?.tabs).toEqual([
      { kind: 'db-table', connectionId: 'db-abc', schema: 'public', table: 'users' }
    ])
  })
})
