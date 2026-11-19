import { create } from 'zustand'
import type { GitLogEntry, GitStatus, ProjectEntry } from '../../../shared/ipc-contracts'
import { projectKey } from './sessions'

/** Состояние git-панели для активного проекта; смена проекта сбрасывает всё, кроме open/width. */
type GitData = Pick<
  GitState,
  | 'projectKey'
  | 'status'
  | 'loading'
  | 'error'
  | 'selectedPath'
  | 'diff'
  | 'diffLoading'
  | 'message'
  | 'generating'
  | 'busy'
  | 'log'
  | 'logOpen'
>

interface GitState {
  /** Панель видима (кнопка в вертикальной панели справа). */
  open: boolean
  /** Ширина панели, тянется за левую границу. */
  width: number
  projectKey: string | null
  status: GitStatus | null
  loading: boolean
  error: string | null
  selectedPath: string | null
  diff: { original: string; modified: string } | null
  diffLoading: boolean
  message: string
  generating: boolean
  busy: boolean
  log: GitLogEntry[]
  logOpen: boolean
  setProject: (project: ProjectEntry | null) => void
  refresh: (project: ProjectEntry) => Promise<void>
  /** Только статус; silent — не трогать error/status при сбое (поллинг, конец хода). */
  refreshStatus: (project: ProjectEntry, silent?: boolean) => Promise<void>
  openFile: (project: ProjectEntry, path: string) => Promise<void>
  closeFile: () => void
  stage: (project: ProjectEntry, paths: string[]) => Promise<void>
  unstage: (project: ProjectEntry, paths: string[]) => Promise<void>
  commit: (project: ProjectEntry) => Promise<void>
  push: (project: ProjectEntry) => Promise<void>
  generate: (project: ProjectEntry) => Promise<void>
  setMessage: (message: string) => void
  setError: (error: string | null) => void
  toggleLog: () => void
  toggleOpen: () => void
  setWidth: (width: number) => void
}

function resetState(): GitData {
  return {
    projectKey: null,
    status: null,
    loading: false,
    error: null,
    selectedPath: null,
    diff: null,
    diffLoading: false,
    message: '',
    generating: false,
    busy: false,
    log: [],
    logOpen: false
  }
}

export const useGitStore = create<GitState>((set, get) => ({
  open: true,
  width: 340,
  ...resetState(),

  setProject: (project) => {
    const key = project === null ? null : projectKey(project)
    if (get().projectKey === key) return
    set({ ...resetState(), projectKey: key })
    if (project !== null) void get().refresh(project)
  },

  refresh: async (project) => {
    if (projectKey(project) !== get().projectKey) return
    set({ loading: true })
    const [statusResult, logResult] = await Promise.all([window.piwright.gitStatus(project), window.piwright.gitLog(project)])
    set((state) => ({
      loading: false,
      status: statusResult.ok ? statusResult.status : state.status,
      error: statusResult.ok ? state.error : statusResult.error,
      log: logResult.entries
    }))
  },

  refreshStatus: async (project, silent = false) => {
    if (projectKey(project) !== get().projectKey) return
    const result = await window.piwright.gitStatus(project)
    set((state) => {
      if (!result.ok) return silent ? state : { error: result.error }
      return { status: result.status }
    })
  },

  openFile: async (project, path) => {
    set({ selectedPath: path, diff: null, diffLoading: true, error: null })
    const result = await window.piwright.gitFileDiff(project, path)
    set((state) =>
      state.selectedPath === path
        ? { diffLoading: false, diff: result.ok ? { original: result.original, modified: result.modified } : null, error: result.ok ? state.error : result.error }
        : state
    )
  },

  closeFile: () => set({ selectedPath: null, diff: null, diffLoading: false }),

  stage: async (project, paths) => {
    set({ busy: true, error: null })
    const result = await window.piwright.gitStage(project, paths)
    set({ busy: false, error: result.ok ? null : result.error })
    if (result.ok) await get().refresh(project)
  },

  unstage: async (project, paths) => {
    set({ busy: true, error: null })
    const result = await window.piwright.gitUnstage(project, paths)
    set({ busy: false, error: result.ok ? null : result.error })
    if (result.ok) await get().refresh(project)
  },

  commit: async (project) => {
    const message = get().message.trim()
    if (message.length === 0) return
    set({ busy: true, error: null })
    const result = await window.piwright.gitCommit(project, message)
    if (result.ok) {
      const status = await window.piwright.gitStatus(project)
      const stillThere = status.ok && status.status !== null && status.status.entries.some((e) => e.path === get().selectedPath)
      set({ busy: false, message: '', status: status.ok ? status.status : get().status })
      if (!stillThere) get().closeFile()
      const log = await window.piwright.gitLog(project)
      set({ log: log.entries })
    } else {
      set({ busy: false, error: result.error })
    }
  },

  push: async (project) => {
    set({ busy: true, error: null })
    const result = await window.piwright.gitPush(project)
    set({ busy: false, error: result.ok ? null : result.error })
    if (result.ok) await get().refresh(project)
  },

  generate: async (project) => {
    set({ generating: true, error: null })
    const result = await window.piwright.gitGenerateMessage(project)
    set((state) => ({
      generating: false,
      message: result.ok ? result.message : state.message,
      error: result.ok ? null : result.error
    }))
  },

  setMessage: (message) => set({ message }),
  setError: (error) => set({ error }),
  toggleLog: () => set((state) => ({ logOpen: !state.logOpen })),
  toggleOpen: () => set((state) => ({ open: !state.open })),
  setWidth: (width) => set({ width: Math.min(Math.max(width, 280), window.innerWidth - 560) })
}))
