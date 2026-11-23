import { create } from 'zustand'
import type {
  ProjectEntry,
  Settings,
  TerminalProfile,
  TerminalProfileId,
  TerminalTabsSnapshot
} from '../../../shared/ipc-contracts'
import { setTerminalTabs } from '../../../shared/terminal-tabs'
import { disposeEntry } from '../views/terminal/term-registry'
import { persistPanel } from './panels-prefs'
import { useSessionsStore } from './sessions'
import { parentTabKey } from './tabs'
import { useGitLogStore } from './gitlog'

interface TermTab {
  id: string
  profileId: TerminalProfileId
  label: string
  /** Юзерское имя вкладки (переименование); undefined — имя профиля. */
  customLabel?: string
  dead: boolean
}

interface ProjectTerms {
  ids: string[]
  activeId: string | null
}

/** Вкладки терминалов на проект: терминалы живут в main, смена проекта переключает набор
 *  вкладок, не убивая чужие. Смена проекта сбрасывает профили, но не вкладки.
 *  Ключ набора — parentTabKey (как у вкладок центра): терминал worktree-сессии и корневого
 *  проекта — один набор, иначе при переключениях док перескакивает между наборами. */
interface TerminalState {
  open: boolean
  /** Высота горизонтального дока внизу экрана. */
  height: number
  projectKey: string | null
  projects: Record<string, ProjectTerms>
  terms: Record<string, TermTab>
  profiles: TerminalProfile[]
  defaultProfileId: TerminalProfileId | null
  error: string | null
  setProject: (project: ProjectEntry | null) => void
  toggleOpen: () => void
  setHeight: (height: number) => void
  /** Создаёт вкладку; возвращает id (null — ошибка). opts.persist=false — без записи в настройки (восстановление). */
  spawn: (project: ProjectEntry, profileId?: TerminalProfileId, opts?: { persist?: boolean }) => Promise<string | null>
  close: (id: string) => Promise<void>
  activate: (id: string) => void
  /** Юзерское переименование вкладки; пустая строка — вернуть имя профиля. */
  rename: (id: string, label: string) => void
  /** Первое появление проекта в доке: восстановить сохранённые вкладки или создать дефолтную. */
  ensureTabs: (project: ProjectEntry) => void
  restoreTabs: (project: ProjectEntry, snapshot: TerminalTabsSnapshot) => Promise<void>
  applyExit: (id: string, code: number) => void
  setError: (error: string | null) => void
}

export const TERMINAL_DOCK_MIN = 120
export const TERMINAL_DOCK_MAX_RESERVE = 160

export const useTerminalStore = create<TerminalState>((set, get) => ({
  open: false,
  height: 300,
  projectKey: null,
  projects: {},
  terms: {},
  profiles: [],
  defaultProfileId: null,
  error: null,

  setProject: (project) => {
    const key = project === null ? null : parentTabKey(project)
    if (get().projectKey === key) return
    set({ projectKey: key, profiles: [], defaultProfileId: null, error: null })
    if (project === null) return
    void window.piwright.termProfiles(project).then((result) => {
      if (parentTabKey(project) !== get().projectKey) return
      if (!result.ok) {
        set({ error: result.error })
        return
      }
      set({ profiles: result.profiles, defaultProfileId: result.defaultProfileId })
    })
    if (get().open) get().ensureTabs(project)
  },

  toggleOpen: () => set((state) => ({ open: !state.open })),

  setHeight: (height) =>
    set({ height: Math.min(Math.max(height, TERMINAL_DOCK_MIN), window.innerHeight - TERMINAL_DOCK_MAX_RESERVE) }),

  spawn: async (project, profileId, opts) => {
    let result: Awaited<ReturnType<typeof window.piwright.termCreate>>
    try {
      result = await window.piwright.termCreate(project, profileId ?? null)
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) })
      return null
    }
    if (!result.ok || result.terminal === null) {
      set({ error: result.error })
      return null
    }
    const info = result.terminal
    const key = parentTabKey(project)
    set((state) => {
      const current = state.projects[key] ?? { ids: [], activeId: null }
      // Терминал и история Git делят нижний док: спавн терминала закрывает историю.
      if (useGitLogStore.getState().open) {
        useGitLogStore.getState().toggleOpen()
        persistPanel('gitlog', { open: false })
      }
      return {
        open: true,
        error: null,
        terms: { ...state.terms, [info.id]: { id: info.id, profileId: info.profileId, label: info.label, dead: false } },
        projects: { ...state.projects, [key]: { ids: [...current.ids, info.id], activeId: info.id } }
      }
    })
    if (opts?.persist !== false) persistTabs(get)
    return info.id
  },

  close: async (id) => {
    await window.piwright.termClose(id)
    disposeEntry(id)
    set((state) => {
      const key = state.projectKey
      if (key === undefined || key === null) return state
      const current = state.projects[key]
      if (current === undefined) return state
      const ids = current.ids.filter((x) => x !== id)
      const activeId =
        current.activeId === id ? (ids[Math.min(current.ids.indexOf(id), ids.length - 1)] ?? null) : current.activeId
      const terms = { ...state.terms }
      delete terms[id]
      return { terms, projects: { ...state.projects, [key]: { ids, activeId } } }
    })
    persistTabs(get)
  },

  activate: (id) => {
    const key = get().projectKey
    if (key === null) return
    set((state) => {
      const current = state.projects[key]
      if (current === undefined) return state
      return { projects: { ...state.projects, [key]: { ...current, activeId: id } } }
    })
    persistTabs(get)
  },

  rename: (id, label) => {
    const tab = get().terms[id]
    if (tab === undefined) return
    const customLabel = label.trim()
    set((state) => ({
      terms: { ...state.terms, [id]: { ...tab, customLabel: customLabel.length > 0 ? customLabel : undefined } }
    }))
    persistTabs(get)
  },

  ensureTabs: (project) => {
    const key = parentTabKey(project)
    if (get().projects[key] !== undefined) return
    const saved = useSessionsStore.getState().settings?.terminalTabs?.[key]
    if (saved === undefined || saved.tabs.length === 0) {
      void get().spawn(project)
      return
    }
    void get().restoreTabs(project, saved)
  },

  restoreTabs: async (project, snapshot) => {
    const key = parentTabKey(project)
    const ids: string[] = []
    for (const saved of snapshot.tabs) {
      if (parentTabKey(project) !== get().projectKey) return
      const id = await get().spawn(project, saved.profileId, { persist: false })
      if (id === null) continue
      ids.push(id)
      if (saved.label !== undefined) {
        set((state) => {
          const tab = state.terms[id]
          if (tab === undefined) return state
          return { terms: { ...state.terms, [id]: { ...tab, customLabel: saved.label } } }
        })
      }
    }
    if (ids.length === 0 || parentTabKey(project) !== get().projectKey) return
    const activeId = ids[Math.min(snapshot.activeIndex ?? 0, ids.length - 1)] ?? null
    set((state) => {
      const current = state.projects[key]
      if (current === undefined) return state
      return { projects: { ...state.projects, [key]: { ...current, activeId } } }
    })
  },

  applyExit: (id) => {
    const tab = get().terms[id]
    if (tab === undefined) return
    set((state) => ({ terms: { ...state.terms, [id]: { ...tab, dead: true } } }))
    persistTabs(get)
  },

  setError: (error) => set({ error })
}))

/** Снимок живых вкладок активного проекта → settings.terminalTabs (мёртвые не сохраняются). */
function persistTabs(get: () => TerminalState): void {
  const state = get()
  const key = state.projectKey
  if (key === null) return
  const current = state.projects[key]
  if (current === undefined) return
  const alive = current.ids.map((id) => state.terms[id]).filter((t) => t !== undefined && !t.dead)
  const tabs = alive.map((t) => (t.customLabel !== undefined ? { profileId: t.profileId, label: t.customLabel } : { profileId: t.profileId }))
  const activeIndex = current.activeId !== null ? alive.findIndex((t) => t.id === current.activeId) : -1
  const snapshot: TerminalTabsSnapshot = {
    tabs,
    ...(activeIndex >= 0 ? { activeIndex } : {})
  }
  const settings = useSessionsStore.getState().settings
  if (settings === null) return
  const patch: Partial<Settings> =
    tabs.length > 0
      ? setTerminalTabs(settings, key, snapshot)
      : { terminalTabs: Object.fromEntries(Object.entries(settings.terminalTabs).filter(([k]) => k !== key)) }
  void window.piwright.setSettings(patch).then((saved) => {
    useSessionsStore.getState().setSettings(saved)
  })
}
