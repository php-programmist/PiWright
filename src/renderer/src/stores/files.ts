/** Состояние браузера файлов для активного проекта; смена проекта сбрасывает всё, кроме open/width.
 *  Открытые файлы — вкладки проекта (stores/tabs.ts), здесь только кэш содержимого + watch. */
import { create } from 'zustand'
import type { FileEntry, ProjectEntry } from '../../../shared/ipc-contracts'
import { isImageFilePath } from '../../../shared/attachments'
import { projectKey, projectForKey } from './sessions'
import { useTabsStore } from './tabs'

interface FilesData {
  projectKey: string | null
  /** Кэш листингов: ключ — каталог проекта ('' — корень). */
  tree: Record<string, { entries: FileEntry[]; loading: boolean }>
  expanded: Record<string, boolean>
  /** Кэш содержимого открытых файлов — ключи синхронизированы с файловыми вкладками tabs-стора. */
  contents: Record<string, string>
  /** Кэш картинок-вкладок (data URL) — те же ключи, что и contents. */
  images: Record<string, string>
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
  /** Перечитка каталога и всех развёрнутых вложенных каталогов (пункт меню «Обновить»). */
  reloadDir: (project: ProjectEntry, dir: string) => Promise<void>
  /** Загрузка содержимого файла (идемпотентно; картинки — data URL в images) + watch открытых. */
  openFile: (project: ProjectEntry, path: string) => Promise<void>
  rename: (project: ProjectEntry, path: string, newName: string) => Promise<boolean>
  remove: (project: ProjectEntry, path: string) => Promise<boolean>
  createDir: (project: ProjectEntry, parentDir: string, name: string) => Promise<boolean>
  createFile: (project: ProjectEntry, parentDir: string, name: string) => Promise<boolean>
  /** Принудительная перечитка файла с диска (пункт меню «Обновить»). */
  reloadFile: (project: ProjectEntry, path: string) => Promise<void>
  /** Файл закрыт как вкладка — сбросить кэш и пересчитать watch. */
  closeContent: (project: ProjectEntry, path: string) => void
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
    contents: {},
    images: {},
    error: null
  }
}

function watchedPaths(state: FilesData): string[] {
  return [...Object.keys(state.contents), ...Object.keys(state.images)]
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
    if (previousKey !== null) void window.piwright.filesWatch(projectForKey(previousKey), [])
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

  reloadDir: async (project, dir) => {
    if (projectKey(project) !== get().projectKey) return
    await get().loadDir(project, dir)
    const prefix = dir === '' ? '' : `${dir}/`
    for (const [key, value] of Object.entries(get().expanded)) {
      if (value && key.startsWith(prefix)) await get().loadDir(project, key)
    }
  },

  openFile: async (project, path) => {
    if (projectKey(project) !== get().projectKey) return
    if (isImageFilePath(path)) {
      if (get().images[path] !== undefined) {
        void window.piwright.filesWatch(project, watchedPaths(get()))
        return
      }
      set({ error: null })
      const result = await window.piwright.filesReadImage(project, path)
      if (projectKey(project) !== get().projectKey) return
      set((state) => {
        const images = result.ok ? { ...state.images, [path]: result.dataUrl } : state.images
        void window.piwright.filesWatch(project, watchedPaths({ ...state, images }))
        return { images, error: !result.ok ? result.error : state.error }
      })
      return
    }
    if (get().contents[path] !== undefined) {
      void window.piwright.filesWatch(project, watchedPaths(get()))
      return
    }
    set({ error: null })
    const result = await window.piwright.filesRead(project, path)
    if (projectKey(project) !== get().projectKey) return
    set((state) => {
      const contents = result.ok ? { ...state.contents, [path]: result.content } : state.contents
      void window.piwright.filesWatch(project, watchedPaths({ ...state, contents }))
      return { contents, error: !result.ok ? result.error : state.error }
    })
  },

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
      const contents: Record<string, string> = {}
      for (const [p, content] of Object.entries(state.contents)) contents[remap(p)] = content
      const images: Record<string, string> = {}
      for (const [p, url] of Object.entries(state.images)) images[remap(p)] = url
      return { tree, expanded, contents, images }
    })
    void window.piwright.filesWatch(project, watchedPaths(get()))
    return true
  },

  remove: async (project, path) => {
    if (projectKey(project) !== get().projectKey) return false
    const result = await window.piwright.filesDelete(project, path)
    if (!result.ok) {
      set({ error: result.error })
      return false
    }
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    const name = path.slice(path.lastIndexOf('/') + 1)
    const deleted: string[] = []
    set((state) => {
      const tree: FilesState['tree'] = {}
      for (const [dir, listing] of Object.entries(state.tree)) {
        if (dir === path || dir.startsWith(`${path}/`)) continue
        tree[dir] =
          dir === parent
            ? { loading: listing.loading, entries: listing.entries.filter((e) => e.name !== name) }
            : listing
      }
      const expanded: Record<string, boolean> = {}
      for (const [dir, value] of Object.entries(state.expanded)) {
        if (dir !== path && !dir.startsWith(`${path}/`)) expanded[dir] = value
      }
      const contents: Record<string, string> = {}
      for (const [p, content] of Object.entries(state.contents)) {
        if (p === path || p.startsWith(`${path}/`)) {
          deleted.push(p)
          continue
        }
        contents[p] = content
      }
      const images: Record<string, string> = {}
      for (const [p, url] of Object.entries(state.images)) {
        if (p === path || p.startsWith(`${path}/`)) {
          deleted.push(p)
          continue
        }
        images[p] = url
      }
      return { tree, expanded, contents, images }
    })
    const tabs = useTabsStore.getState()
    for (const p of deleted) tabs.closeTab(project, `file\u0000${p}`)
    void window.piwright.filesWatch(project, watchedPaths(get()))
    return true
  },

  createDir: async (project, parentDir, name) => {
    if (projectKey(project) !== get().projectKey) return false
    const path = parentDir === '' ? name : `${parentDir}/${name}`
    const result = await window.piwright.filesMkdir(project, path)
    if (!result.ok) {
      set({ error: result.error })
      return false
    }
    await get().loadDir(project, parentDir)
    return true
  },

  createFile: async (project, parentDir, name) => {
    if (projectKey(project) !== get().projectKey) return false
    const path = parentDir === '' ? name : `${parentDir}/${name}`
    const result = await window.piwright.filesWrite(project, path, '')
    if (!result.ok) {
      set({ error: result.error })
      return false
    }
    await get().loadDir(project, parentDir)
    return true
  },

  reloadFile: async (project, path) => {
    if (projectKey(project) !== get().projectKey) return
    if (isImageFilePath(path)) {
      if (get().images[path] === undefined) return
      const result = await window.piwright.filesReadImage(project, path)
      if (!result.ok || projectKey(project) !== get().projectKey || get().images[path] === undefined) return
      set((state) => ({ images: { ...state.images, [path]: result.dataUrl } }))
      return
    }
    if (get().contents[path] === undefined) return
    const result = await window.piwright.filesRead(project, path)
    if (projectKey(project) !== get().projectKey || get().contents[path] === undefined) return
    if (!result.ok) return
    set((state) => ({ contents: { ...state.contents, [path]: result.content } }))
  },

  closeContent: (project, path) => {
    const contents = { ...get().contents }
    delete contents[path]
    const images = { ...get().images }
    delete images[path]
    set({ contents, images })
    void window.piwright.filesWatch(project, watchedPaths({ ...get(), contents, images }))
  },

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
    if (projectKey(project) !== state.projectKey) return
    if (isImageFilePath(path)) {
      if (state.images[path] === undefined) return
      const result = await window.piwright.filesReadImage(project, path)
      if (projectKey(project) !== get().projectKey || get().images[path] === undefined) return
      set((s) => ({ images: result.ok ? { ...s.images, [path]: result.dataUrl } : s.images }))
      return
    }
    if (state.contents[path] === undefined) return
    const result = await window.piwright.filesRead(project, path)
    if (projectKey(project) !== get().projectKey || get().contents[path] === undefined) return
    set((s) => ({ contents: { ...s.contents, [path]: result.ok ? result.content : (s.contents[path] ?? '') } }))
  }
}))
