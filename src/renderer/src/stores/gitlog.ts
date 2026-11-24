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
  /** Загруженные страницы по 50; hasMore — есть ли следующая. */
  page: number
  hasMore: boolean
  loadingMore: boolean
  /** Выбранный коммит: список ужимается, сбоку — детали и файлы. */
  selectedHash: string | null
  files: GitCommitFileEntry[]
  filesLoading: boolean
  /** Поиск: подстрока сообщения или префикс хэша (пустая строка — без поиска). */
  query: string
  /** Фильтр ветки: null — текущий HEAD, allBranches — все ветки (дефолт, как в PHPStorm). */
  branch: string | null
  allBranches: boolean
  /** Локальные + remote-tracking ветки для выпадающего фильтра. */
  branches: string[]
  setProject: (project: ProjectEntry | null) => void
  refresh: (project: ProjectEntry) => Promise<void>
  /** Догрузить следующую страницу (если есть); возвращает true — что-то догрузилось. */
  loadMore: (project: ProjectEntry) => Promise<boolean>
  select: (project: ProjectEntry, hash: string | null) => Promise<void>
  /** Установить поисковый запрос и перезагрузить первую страницу. */
  setQuery: (project: ProjectEntry, query: string) => Promise<void>
  /** Установить фильтр веток и перезагрузить первую страницу. */
  setBranchFilter: (project: ProjectEntry, branch: string | null, all: boolean) => Promise<void>
  /** Подгрузить список веток для фильтра (локальные + remote-tracking). */
  loadBranches: (project: ProjectEntry) => Promise<void>
  toggleOpen: () => void
  setHeight: (height: number) => void
  setError: (error: string | null) => void
}

function resetState(): Pick<
  GitLogState,
  | 'projectKey'
  | 'entries'
  | 'loading'
  | 'error'
  | 'page'
  | 'hasMore'
  | 'loadingMore'
  | 'selectedHash'
  | 'files'
  | 'filesLoading'
  | 'query'
  | 'branch'
  | 'allBranches'
  | 'branches'
> {
  return {
    projectKey: null,
    entries: [],
    loading: false,
    error: null,
    page: 0,
    hasMore: false,
    loadingMore: false,
    selectedHash: null,
    files: [],
    filesLoading: false,
    query: '',
    branch: null,
    allBranches: true,
    branches: []
  }
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
    const { query, branch, allBranches } = get()
    const result = await window.piwright.gitLog(project, 0, {
      query: query.length > 0 ? query : undefined,
      branch,
      all: allBranches
    })
    set((state) => ({
      loading: false,
      entries: result.entries,
      page: 0,
      hasMore: result.hasMore,
      error: result.ok ? state.error : result.error
    }))
  },

  loadMore: async (project) => {
    const state = get()
    if (projectKey(project) !== state.projectKey || !state.hasMore || state.loadingMore || state.loading) return false
    set({ loadingMore: true })
    const { query, branch, allBranches } = get()
    const result = await window.piwright.gitLog(project, state.page + 1, {
      query: query.length > 0 ? query : undefined,
      branch,
      all: allBranches
    })
    const stale = projectKey(project) !== get().projectKey
    if (stale) return false
    set((prev) => {
      if (!result.ok) return { loadingMore: false, error: result.error }
      const known = new Set(prev.entries.map((e) => e.hash))
      const fresh = result.entries.filter((e) => !known.has(e.hash))
      return {
        loadingMore: false,
        entries: [...prev.entries, ...fresh],
        page: prev.page + 1,
        hasMore: result.hasMore
      }
    })
    return result.ok
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

  setQuery: async (project, query) => {
    if (projectKey(project) !== get().projectKey || get().query === query) return
    set({ query })
    await get().refresh(project)
  },

  setBranchFilter: async (project, branch, all) => {
    if (projectKey(project) !== get().projectKey) return
    if (get().branch === branch && get().allBranches === all) return
    set({ branch, allBranches: all })
    await get().refresh(project)
  },

  loadBranches: async (project) => {
    if (projectKey(project) !== get().projectKey) return
    const result = await window.piwright.gitBranches(project, true)
    if (projectKey(project) !== get().projectKey) return
    if (result.ok) set({ branches: result.branches })
  },

  toggleOpen: () => set((state) => ({ open: !state.open })),
  setHeight: (height) => set({ height: Math.min(Math.max(height, 120), window.innerHeight - 160) }),
  setError: (error) => set({ error })
}))
