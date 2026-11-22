import { create } from 'zustand'
import type { KanbanBoardSummary, ProjectEntry } from '../../../shared/ipc-contracts'
import { projectKey } from './sessions'

/** Состояние канбан-панели для активного проекта; смена проекта сбрасывает всё, кроме open/width. */
interface KanbanState {
  /** Панель видима (кнопка в вертикальной панели справа). */
  open: boolean
  /** Ширина панели, тянется за левую границу. */
  width: number
  projectKey: string | null
  boards: KanbanBoardSummary[]
  loading: boolean
  error: string | null
  setProject: (project: ProjectEntry | null) => void
  refresh: (project: ProjectEntry) => Promise<void>
  create: (project: ProjectEntry, name: string) => Promise<boolean>
  rename: (project: ProjectEntry, boardId: string, name: string) => Promise<boolean>
  remove: (project: ProjectEntry, boardId: string) => Promise<boolean>
  toggleOpen: () => void
  setWidth: (width: number) => void
}

export const useKanbanStore = create<KanbanState>((set, get) => ({
  open: false,
  width: 260,
  projectKey: null,
  boards: [],
  loading: false,
  error: null,

  setProject: (project) => {
    const key = project === null ? null : projectKey(project)
    if (get().projectKey === key) return
    set({ projectKey: key, boards: [], loading: false, error: null })
    if (project !== null) void get().refresh(project)
  },

  refresh: async (project) => {
    if (projectKey(project) !== get().projectKey) return
    set({ loading: true })
    const result = await window.piwright.kanbanBoards(project)
    set((state) => ({
      loading: false,
      boards: result.ok ? result.boards : state.boards,
      error: result.ok ? state.error : result.error
    }))
  },

  create: async (project, name) => {
    const result = await window.piwright.kanbanBoardCreate(project, name)
    if (!result.ok) {
      set({ error: result.error })
      return false
    }
    await get().refresh(project)
    return true
  },

  rename: async (project, boardId, name) => {
    const result = await window.piwright.kanbanBoardRename(project, boardId, name)
    if (!result.ok) {
      set({ error: result.error })
      return false
    }
    await get().refresh(project)
    return true
  },

  remove: async (project, boardId) => {
    const result = await window.piwright.kanbanBoardDelete(project, boardId)
    if (!result.ok) {
      set({ error: result.error })
      return false
    }
    await get().refresh(project)
    return true
  },

  toggleOpen: () => set((state) => ({ open: !state.open })),
  setWidth: (width) => set({ width })
}))
