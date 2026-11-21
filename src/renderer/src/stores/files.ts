import { create } from 'zustand'
import type { FileEntry, ProjectEntry } from '../../../shared/ipc-contracts'
import { projectKey } from './sessions'

/** Состояние браузера файлов для активного проекта; смена проекта сбрасывает всё, кроме open/width. */
interface FilesData {
  projectKey: string | null
  /** Кэш листингов: ключ — каталог проекта ('' — корень). */
  tree: Record<string, { entries: FileEntry[]; loading: boolean }>
  expanded: Record<string, boolean>
  viewerOpen: boolean
  tabs: string[]
  activePath: string | null
  contents: Record<string, string>
  error: string | null
}

interface FilesState extends FilesData {
  open: boolean
  width: number
  /** Перенос длинных строк в редакторе файлов — переживает смену проекта. */
  wordWrap: boolean
  setProject: (project: ProjectEntry | null) => void
  toggleOpen: () => void
  setWidth: (width: number) => void
  loadDir: (project: ProjectEntry, dir: string) => Promise<void>
  toggleDir: (project: ProjectEntry, dir: string) => Promise<void>
  refresh: (project: ProjectEntry) => Promise<void>
  openFile: (project: ProjectEntry, path: string) => Promise<void>
  rename: (project: ProjectEntry, path: string, newName: string) => Promise<boolean>
  closeTab: (project: ProjectEntry, path: string) => void
  setActiveTab: (path: string) => void
  closeViewer: () => void
  setError: (error: string | null) => void
  toggleWordWrap: () => void
  /** Оптимистичная запись md-файла (live-preview): контент сразу в сторе, при ошибке — перечит. */
  saveContent: (project: ProjectEntry, path: string, content: string) => Promise<boolean>
  applyFileChanged: (project: ProjectEntry, path: string) => Promise<void>
}

function resetState(): FilesData {
  return {
    projectKey: null,
    tree: {},
    expanded: {},
    viewerOpen: false,
    tabs: [],
    activePath: null,
    contents: {},
    error: null
  }
}

function projectFromKey(key: string): ProjectEntry {
  const [kind, dir] = key.split('\u0000')
  return { kind: kind as ProjectEntry['kind'], dir }
}

export const useFilesStore = create<FilesState>((set, get) => ({
  open: false,
  width: 280,
  wordWrap: false,
  ...resetState(),

  setProject: (project) => {
    const key = project === null ? null : projectKey(project)
    if (get().projectKey === key) return
    const previousKey = get().projectKey
    if (previousKey !== null) void window.piwright.filesWatch(projectFromKey(previousKey), [])
    set({ ...resetState(), projectKey: key })
    if (project !== null) void get().loadDir(project, '')
  },

  toggleOpen: () => set((state) => ({ open: !state.open })),

  setWidth: (width) => set({ width: Math.min(Math.max(width, 200), window.innerWidth - 560) }),

  loadDir: async (project, dir) => {
    if (projectKey(project) !== get().projectKey) return
    set((state) => ({ tree: { ...state.tree, [dir]: { entries: state.tree[dir]?.entries ?? [], loading: true } } }))
    const result = await window.piwright.filesList(project, dir)
    set((state) => {
      if (projectKey(project) !== state.projectKey) return state
      if (!result.ok) return { tree: { ...state.tree, [dir]: { entries: [], loading: false } }, error: result.error }
      return { tree: { ...state.tree, [dir]: { entries: result.entries, loading: false } } }
    })
  },

  toggleDir: async (project, dir) => {
    const wasExpanded = get().expanded[dir] ?? false
    set((state) => ({ expanded: { ...state.expanded, [dir]: !wasExpanded } }))
    if (!wasExpanded && get().tree[dir] === undefined) await get().loadDir(project, dir)
  },

  refresh: async (project) => {
    if (projectKey(project) !== get().projectKey) return
    set({ tree: {} })
    await get().loadDir(project, '')
    for (const dir of Object.keys(get().expanded)) {
      if (get().expanded[dir]) await get().loadDir(project, dir)
    }
  },

  openFile: async (project, path) => {
    if (projectKey(project) !== get().projectKey) return
    const tabs = get().tabs.includes(path) ? get().tabs : [...get().tabs, path]
    set({ tabs, activePath: path, viewerOpen: true, error: null })
    void window.piwright.filesWatch(project, tabs)
    const result = await window.piwright.filesRead(project, path)
    if (projectKey(project) !== get().projectKey) return
    set((state) => ({
      contents: { ...state.contents, [path]: result.ok ? result.content : '' },
      error: !result.ok && state.activePath === path ? result.error : state.error
    }))
  },

  /** Переименование: ремап кэшей дерева/вкладок; открытые файлы остаются открытыми. */
  rename: async (project, path, newName) => {
    if (projectKey(project) !== get().projectKey) return false
    const result = await window.piwright.filesRename(project, path, newName)
    if (!result.ok) {
      set({ error: result.error })
      return false
    }
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    const name = path.slice(path.lastIndexOf('/') + 1)
    const newPath = parent === '' ? newName : `${parent}/${newName}`
    const remap = (p: string): string =>
      p === path ? newPath : p.startsWith(`${path}/`) ? `${newPath}${p.slice(path.length)}` : p
    set((state) => {
      const tree: FilesState['tree'] = {}
      for (const [dir, listing] of Object.entries(state.tree)) {
        tree[remap(dir)] = {
          loading: listing.loading,
          entries:
            dir === parent
              ? listing.entries.map((e) => (e.name === name ? { ...e, name: newName } : e))
              : listing.entries
        }
      }
      const expanded: Record<string, boolean> = {}
      for (const [dir, value] of Object.entries(state.expanded)) expanded[remap(dir)] = value
      const tabs = state.tabs.map(remap)
      const contents: Record<string, string> = {}
      for (const [p, content] of Object.entries(state.contents)) contents[remap(p)] = content
      return { tree, expanded, tabs, contents, activePath: state.activePath === null ? null : remap(state.activePath) }
    })
    void window.piwright.filesWatch(project, get().tabs)
    return true
  },

  closeTab: (project, path) => {
    const index = get().tabs.indexOf(path)
    if (index < 0) return
    const tabs = get().tabs.filter((p) => p !== path)
    const contents = { ...get().contents }
    delete contents[path]
    const activePath = get().activePath === path ? (tabs[Math.min(index, tabs.length - 1)] ?? null) : get().activePath
    set({ tabs, contents, activePath, viewerOpen: tabs.length > 0 ? get().viewerOpen : false })
    void window.piwright.filesWatch(project, tabs)
  },

  setActiveTab: (path) => set({ activePath: path }),

  closeViewer: () => set({ viewerOpen: false }),

  setError: (error) => set({ error }),

  toggleWordWrap: () => set((state) => ({ wordWrap: !state.wordWrap })),

  saveContent: async (project, path, content) => {
    set((state) => ({ contents: { ...state.contents, [path]: content } }))
    const result = await window.piwright.filesWrite(project, path, content)
    if (!result.ok) {
      set({ error: result.error })
      await get().applyFileChanged(project, path)
      return false
    }
    return true
  },

  applyFileChanged: async (project, path) => {
    const state = get()
    if (projectKey(project) !== state.projectKey || !state.tabs.includes(path)) return
    const result = await window.piwright.filesRead(project, path)
    if (projectKey(project) !== get().projectKey || !get().tabs.includes(path)) return
    set((s) => ({ contents: { ...s.contents, [path]: result.ok ? result.content : (s.contents[path] ?? '') } }))
  }
}))
