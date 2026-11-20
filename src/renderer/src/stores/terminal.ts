import { create } from 'zustand'
import type { ProjectEntry, TerminalProfile, TerminalProfileId } from '../../../shared/ipc-contracts'
import { disposeEntry } from '../views/terminal/term-registry'
import { projectKey } from './sessions'

interface TermTab {
  id: string
  profileId: TerminalProfileId
  label: string
  dead: boolean
}

interface ProjectTerms {
  ids: string[]
  activeId: string | null
}

/** Вкладки терминалов на проект: терминалы живут в main, смена проекта переключает набор
 *  вкладок, не убивая чужие. Смена проекта сбрасывает профили, но не вкладки. */
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
  spawn: (project: ProjectEntry, profileId?: TerminalProfileId) => Promise<void>
  close: (id: string) => Promise<void>
  activate: (id: string) => void
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
    const key = project === null ? null : projectKey(project)
    if (get().projectKey === key) return
    set({ projectKey: key, profiles: [], defaultProfileId: null, error: null })
    if (project === null) return
    void window.piwright.termProfiles(project).then((result) => {
      if (projectKey(project) !== get().projectKey) return
      if (!result.ok) {
        set({ error: result.error })
        return
      }
      set({ profiles: result.profiles, defaultProfileId: result.defaultProfileId })
    })
  },

  toggleOpen: () => set((state) => ({ open: !state.open })),

  setHeight: (height) =>
    set({ height: Math.min(Math.max(height, TERMINAL_DOCK_MIN), window.innerHeight - TERMINAL_DOCK_MAX_RESERVE) }),

  spawn: async (project, profileId) => {
    const result = await window.piwright.termCreate(project, profileId ?? null)
    if (!result.ok || result.terminal === null) {
      set({ error: result.error })
      return
    }
    const info = result.terminal
    const key = projectKey(project)
    set((state) => {
      const current = state.projects[key] ?? { ids: [], activeId: null }
      return {
        open: true,
        error: null,
        terms: { ...state.terms, [info.id]: { id: info.id, profileId: info.profileId, label: info.label, dead: false } },
        projects: { ...state.projects, [key]: { ids: [...current.ids, info.id], activeId: info.id } }
      }
    })
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
  },

  activate: (id) => {
    const key = get().projectKey
    if (key === null) return
    set((state) => {
      const current = state.projects[key]
      if (current === undefined) return state
      return { projects: { ...state.projects, [key]: { ...current, activeId: id } } }
    })
  },

  applyExit: (id) => {
    const tab = get().terms[id]
    if (tab === undefined) return
    set((state) => ({ terms: { ...state.terms, [id]: { ...tab, dead: true } } }))
  },

  setError: (error) => set({ error })
}))
