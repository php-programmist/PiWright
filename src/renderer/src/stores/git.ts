import { create } from 'zustand'
import type { GitBranchSync, GitSequencerState, GitStatus, ProjectEntry } from '../../../shared/ipc-contracts'
import { projectKey } from './sessions'

/** Состояние git-панели для активного проекта; смена проекта сбрасывает всё, кроме open/width. */
type GitData = Pick<
  GitState,
  | 'projectKey'
  | 'status'
  | 'loading'
  | 'error'
  | 'selectedPath'
  | 'commitHash'
  | 'diff'
  | 'diffLoading'
  | 'message'
  | 'generating'
  | 'busy'
  | 'branches'
  | 'branchSync'
  | 'conflict'
  | 'conflictOpen'
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
  /** Хеш коммита открытого диффа (null — дифф рабочей копии). */
  commitHash: string | null
  diff: { original: string; modified: string } | null
  diffLoading: boolean
  message: string
  generating: boolean
  busy: boolean
  branches: string[]
  /** Ahead/behind по локальным веткам (для стрелок в селекторе); обновляется после fetch/push/pull. */
  branchSync: GitBranchSync[]
  /** Sequencer в процессе (rebase/merge с конфликтами); null — конфликтов нет. */
  conflict: { state: GitSequencerState; repoRoot: string | null } | null
  /** Открыт диалог Resolve Conflicts. */
  conflictOpen: boolean
  setProject: (project: ProjectEntry | null) => void
  refresh: (project: ProjectEntry) => Promise<void>
  /** Только статус; silent — не трогать error/status при сбое (поллинг, конец хода). */
  refreshStatus: (project: ProjectEntry, silent?: boolean) => Promise<void>
  /** Только ahead/behind веток; при сбое данные остаются старыми (стрелки просто не обновляются). */
  refreshBranchSync: (project: ProjectEntry) => Promise<void>
  openFile: (project: ProjectEntry, path: string) => Promise<void>
  /** Дифф файла в коммите (из истории Git). */
  openCommitFile: (project: ProjectEntry, hash: string, path: string) => Promise<void>
  closeFile: () => void
  stage: (project: ProjectEntry, paths: string[]) => Promise<void>
  unstage: (project: ProjectEntry, paths: string[]) => Promise<void>
  commit: (project: ProjectEntry) => Promise<void>
  push: (project: ProjectEntry) => Promise<void>
  /** Push конкретной ветки (кнопки в подменю селектора веток). */
  pushBranch: (project: ProjectEntry, branch: string, forceWithLease: boolean) => Promise<void>
  /** Pull ветки: rebase/merge — текущая, ff — не текущая. */
  pullBranch: (project: ProjectEntry, branch: string, mode: 'rebase' | 'merge' | 'ff') => Promise<void>
  /** Перебазировать текущую ветку на onto (пункт подменю ветки). */
  rebase: (project: ProjectEntry, onto: string) => Promise<void>
  /** Чекаут branch и перебазировать её на onto (пункт подменю ветки). */
  checkoutRebase: (project: ProjectEntry, branch: string, onto: string) => Promise<void>
  /** Состояние sequencer'а (rebase/merge в процессе); при конфликте — открыть диалог. */
  refreshConflict: (project: ProjectEntry) => Promise<void>
  openConflicts: () => void
  closeConflicts: () => void
  /** Разрешить конфликт одной стороной (Yours/Theirs) — checkout + add. */
  resolveConflictSide: (project: ProjectEntry, path: string, side: 'ours' | 'theirs') => Promise<void>
  /** Завершить rebase/merge после разрешения конфликтов. */
  continueConflict: (project: ProjectEntry) => Promise<void>
  /** Отменить rebase/merge. */
  abortConflict: (project: ProjectEntry) => Promise<void>
  checkout: (project: ProjectEntry, name: string, create: boolean, startPoint?: string) => Promise<void>
  renameBranch: (project: ProjectEntry, oldName: string, newName: string) => Promise<void>
  deleteBranch: (project: ProjectEntry, name: string) => Promise<void>
  generate: (project: ProjectEntry) => Promise<void>
  setMessage: (message: string) => void
  setError: (error: string | null) => void
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
    commitHash: null,
    diff: null,
    diffLoading: false,
    message: '',
    generating: false,
    busy: false,
    branches: [],
    branchSync: [],
    conflict: null,
    conflictOpen: false
  }
}

export const useGitStore = create<GitState>((set, get) => {
  /** После неудачной операции: обновить статус (конфликтные файлы) + sequencer-состояние,
   *  открыть диалог, если rebase/merge в процессе. */
  const afterOpFailure = async (project: ProjectEntry): Promise<void> => {
    await Promise.all([get().refreshStatus(project, true), get().refreshConflict(project)])
    if (get().conflict !== null) set({ conflictOpen: true })
  }

  return {
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
    const [statusResult, branchesResult, syncResult, conflictResult] = await Promise.all([
      window.piwright.gitStatus(project),
      window.piwright.gitBranches(project),
      window.piwright.gitBranchSync(project),
      window.piwright.gitConflictState(project)
    ])
    set((state) => ({
      loading: false,
      status: statusResult.ok ? statusResult.status : state.status,
      error: statusResult.ok ? state.error : statusResult.error,
      branches: branchesResult.branches,
      branchSync: syncResult.ok ? syncResult.branches : state.branchSync,
      conflict:
        conflictResult.ok && conflictResult.state !== 'none'
          ? { state: conflictResult.state, repoRoot: conflictResult.repoRoot }
          : null
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

  refreshBranchSync: async (project) => {
    if (projectKey(project) !== get().projectKey) return
    const result = await window.piwright.gitBranchSync(project)
    if (result.ok) set({ branchSync: result.branches })
  },

  openFile: async (project, path) => {
    set({ selectedPath: path, commitHash: null, diff: null, diffLoading: true, error: null })
    const result = await window.piwright.gitFileDiff(project, path)
    set((state) =>
      state.selectedPath === path && state.commitHash === null
        ? { diffLoading: false, diff: result.ok ? { original: result.original, modified: result.modified } : null, error: result.ok ? state.error : result.error }
        : state
    )
  },

  openCommitFile: async (project, hash, path) => {
    set({ selectedPath: path, commitHash: hash, diff: null, diffLoading: true, error: null })
    const result = await window.piwright.gitCommitFileDiff(project, hash, path)
    set((state) =>
      state.selectedPath === path && state.commitHash === hash
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

  pushBranch: async (project, branch, forceWithLease) => {
    set({ busy: true, error: null })
    const result = await window.piwright.gitPushBranch(project, branch, forceWithLease)
    set({ busy: false, error: result.ok ? null : result.error })
    if (result.ok) await get().refresh(project)
  },

  pullBranch: async (project, branch, mode) => {
    set({ busy: true, error: null })
    const result = await window.piwright.gitPullBranch(project, branch, mode)
    set({ busy: false, error: result.ok ? null : result.error })
    if (result.ok) await get().refresh(project)
    else await afterOpFailure(project)
  },

  rebase: async (project, onto) => {
    set({ busy: true, error: null })
    const result = await window.piwright.gitRebase(project, onto)
    set({ busy: false, error: result.ok ? null : result.error })
    if (result.ok) await get().refresh(project)
    else await afterOpFailure(project)
  },

  checkoutRebase: async (project, branch, onto) => {
    set({ busy: true, error: null })
    const result = await window.piwright.gitCheckoutRebase(project, branch, onto)
    set({ busy: false, error: result.ok ? null : result.error })
    if (result.ok) {
      get().closeFile()
      await get().refresh(project)
    } else await afterOpFailure(project)
  },

  refreshConflict: async (project) => {
    if (projectKey(project) !== get().projectKey) return
    const result = await window.piwright.gitConflictState(project)
    if (!result.ok) return
    set({ conflict: result.state === 'none' ? null : { state: result.state, repoRoot: result.repoRoot } })
  },

  openConflicts: () => set({ conflictOpen: true }),

  closeConflicts: () => set({ conflictOpen: false }),

  resolveConflictSide: async (project, path, side) => {
    set({ busy: true, error: null })
    const result = await window.piwright.gitConflictResolve(project, path, side)
    set({ busy: false, error: result.ok ? null : result.error })
    if (result.ok) await get().refreshStatus(project, true)
  },

  continueConflict: async (project) => {
    set({ busy: true, error: null })
    const result = await window.piwright.gitConflictContinue(project)
    set({ busy: false, error: result.ok ? null : result.error })
    await get().refresh(project)
    if (get().conflict === null) set({ conflictOpen: false })
  },

  abortConflict: async (project) => {
    set({ busy: true, error: null })
    const result = await window.piwright.gitConflictAbort(project)
    set({ busy: false, error: result.ok ? null : result.error })
    if (result.ok) {
      set({ conflictOpen: false })
      await get().refresh(project)
    }
  },

  checkout: async (project, name, create, startPoint) => {
    set({ busy: true, error: null })
    const result = await window.piwright.gitCheckout(project, name, create, startPoint)
    if (!result.ok) {
      set({ busy: false, error: result.error })
      return
    }
    get().closeFile()
    await get().refresh(project)
    set({ busy: false })
  },

  renameBranch: async (project, oldName, newName) => {
    set({ busy: true, error: null })
    const result = await window.piwright.gitBranchRename(project, oldName, newName)
    set({ busy: false, error: result.ok ? null : result.error })
    if (result.ok) await get().refresh(project)
  },

  deleteBranch: async (project, name) => {
    set({ busy: true, error: null })
    const result = await window.piwright.gitBranchDelete(project, name)
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
  toggleOpen: () => set((state) => ({ open: !state.open })),
  setWidth: (width) => set({ width: Math.min(Math.max(width, 280), window.innerWidth - 560) })
  }
})
