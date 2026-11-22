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
})
