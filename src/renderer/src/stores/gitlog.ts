import { create } from 'zustand'
import type { GitCommitFileEntry, GitLogEntry, ProjectEntry } from '../../../shared/ipc-contracts'
import { projectKey } from './sessions'

/** Состояние дока Git Log для активного проекта; смена проекта сбрасывает всё, кроме open/height. */
interface GitLogState {
  /** Док видим (кнопка над терминалом); взаимоисключаем с терминалом. */
  open: boolean
  /** Высота дока, тянется за верхнюю границу. */
  height: number
  projectKey: string | null
  entries: GitLogEntry[]
  loading: boolean
  error: string | null
  /** Выбранный коммит: список ужимается, сбоку — детали и файлы. */
  selectedHash: string | null
  files: GitCommitFileEntry[]
  filesLoading: boolean
  setProject: (project: ProjectEntry | null) => void
  refresh: (project: ProjectEntry) => Promise<void>
  select: (project: ProjectEntry, hash: string | null) => Promise<void>
  toggleOpen: () => void
  setHeight: (height: number) => void
  setError: (error: string | null) => void
}

function resetState(): Pick<GitLogState, 'projectKey' | 'entries' | 'loading' | 'error' | 'selectedHash' | 'files' | 'filesLoading'> {
  return { projectKey: null, entries: [], loading: false, error: null, selectedHash: null, files: [], filesLoading: false }
}

export const useGitLogStore = create<GitLogState>((set, get) => ({
  open: false,
  height: 300,
  ...resetState(),

  setProject: (project) => {
    const key = project === null ? null : projectKey(project)
    if (get().projectKey === key) return
    set({ ...resetState(), projectKey: key })
    if (project !== null && get().open) void get().refresh(project)
  },

  refresh: async (project) => {
    if (projectKey(project) !== get().projectKey) return
    set({ loading: true })
    const result = await window.piwright.gitLog(project)
    set((state) => ({
      loading: false,
      entries: result.entries,
      error: result.ok ? state.error : result.error
    }))
  },

  select: async (project, hash) => {
    if (hash === null || get().selectedHash === hash) {
      set({ selectedHash: null, files: [], filesLoading: false })
      return
    }
    set({ selectedHash: hash, files: [], filesLoading: true, error: null })
    const result = await window.piwright.gitCommitFiles(project, hash)
    set((state) =>
      state.selectedHash === hash
        ? { filesLoading: false, files: result.ok ? result.files : [], error: result.ok ? state.error : result.error }
        : state
    )
  },

  toggleOpen: () => set((state) => ({ open: !state.open })),
  setHeight: (height) => set({ height: Math.min(Math.max(height, 120), window.innerHeight - 160) }),
  setError: (error) => set({ error })
}))
