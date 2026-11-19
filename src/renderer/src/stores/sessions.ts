import { create } from 'zustand'
import { useChatStore } from './chat'
import type { ProjectEntry, SessionSummary, SessionDot, Settings } from '../../../shared/ipc-contracts'

/** Активная сессия панели: статус с main + флаг открытой вкладки. */
export interface SessionRow {
  hostId: string
  project: ProjectEntry
  title: string
  dot: SessionDot
  state: string
}

/** Проект панели: строка + его история (подгружается лениво). */
export interface ProjectRow {
  project: ProjectEntry
  history: SessionSummary[]
  historyLoading: boolean
  showAllHistory: boolean
}

interface SessionsState {
  projects: ProjectRow[]
  active: SessionRow[]
  activeHostId: string | null
  expanded: Record<string, boolean>
  load: () => Promise<void>
  applyStatus: (status: import('../../../shared/ipc-contracts').PiStatus) => void
  forgetHost: (hostId: string) => void
  setActive: (hostId: string | null) => void
  addProject: (project: ProjectEntry) => Promise<void>
  removeProject: (project: ProjectEntry) => Promise<void>
  toggleExpanded: (key: string) => void
  refreshHistory: (project: ProjectEntry) => Promise<void>
  setShowAll: (key: string, showAll: boolean) => void
  setSettings: (settings: Settings) => void
  settings: Settings | null
}

export const HISTORY_PREVIEW_LIMIT = 3

export function projectKey(project: ProjectEntry): string {
  return `${project.kind}\u0000${project.dir}`
}

function sortProjects(projects: ProjectRow[]): ProjectRow[] {
  return [...projects].sort((a, b) =>
    a.project.kind === b.project.kind ? a.project.dir.localeCompare(b.project.dir) : a.project.kind.localeCompare(b.project.kind)
  )
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  projects: [],
  active: [],
  activeHostId: null,
  expanded: {},
  settings: null,

  load: async () => {
    const [snapshot, settings] = await Promise.all([window.piwright.listSessions(), window.piwright.getSettings()])
    useChatStore.getState().setSettings(settings)
    set((state) => ({
      active: snapshot.active.map((s) => ({ hostId: s.hostId, project: s.project, title: s.title, dot: s.dot, state: s.state })),
      activeHostId: state.activeHostId ?? snapshot.active[0]?.hostId ?? null,
      settings,
      projects: sortProjects(settings.projects.map((project) => {
        const existing = state.projects.find((p) => projectKey(p.project) === projectKey(project))
        return existing ?? { project, history: [], historyLoading: false, showAllHistory: false }
      }))
    }))
    for (const row of get().projects) void get().refreshHistory(row.project)
  },

  applyStatus: (status) => {
    set((state) => {
      const active = state.active.filter((r) => r.hostId !== status.hostId)
      active.push({ hostId: status.hostId, project: status.project, title: status.title, dot: status.dot, state: status.state })
      return { active }
    })
  },

  forgetHost: (hostId) => {
    set((state) => {
      const active = state.active.filter((r) => r.hostId !== hostId)
      return { active, activeHostId: state.activeHostId === hostId ? (active[0]?.hostId ?? null) : state.activeHostId }
    })
  },

  setActive: (hostId) => set({ activeHostId: hostId }),

  addProject: async (project) => {
    const settings = await window.piwright.setSettings({ projects: [...get().projects.map((p) => p.project), project] })
    set((state) => ({
      settings,
      projects: sortProjects(settings.projects.map((p) => {
        const existing = state.projects.find((x) => projectKey(x.project) === projectKey(p))
        return existing ?? { project: p, history: [], historyLoading: false, showAllHistory: false }
      }))
    }))
    void get().refreshHistory(project)
  },

  removeProject: async (project) => {
    const settings = await window.piwright.setSettings({
      projects: get().projects.map((p) => p.project).filter((p) => projectKey(p) !== projectKey(project))
    })
    set((state) => ({
      settings,
      projects: state.projects.filter((p) => projectKey(p.project) !== projectKey(project))
    }))
  },

  toggleExpanded: (key) =>
    set((state) => ({ expanded: { ...state.expanded, [key]: !(state.expanded[key] ?? false) } })),

  refreshHistory: async (project) => {
    const key = projectKey(project)
    set((state) => ({
      projects: state.projects.map((p) => (projectKey(p.project) === key ? { ...p, historyLoading: true } : p))
    }))
    const history = await window.piwright.sessionHistory(project)
    set((state) => ({
      projects: state.projects.map((p) => (projectKey(p.project) === key ? { ...p, history, historyLoading: false } : p))
    }))
  },

  setShowAll: (key, showAll) =>
    set((state) => ({
      projects: state.projects.map((p) => (projectKey(p.project) === key ? { ...p, showAllHistory: showAll } : p))
    })),

  setSettings: (settings) => set({ settings })
}))
