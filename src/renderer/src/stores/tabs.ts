/** Вкладки проектов в центре workspace: сессии (производные от активных), файлы, диффы,
 *  MCP, навыки, транскрипты. Сессии и транскрипты в settings не пишутся (сессии не
 *  возобновляются при открытии проекта), остальные — снимком в Settings.projectTabs. */
import { create } from 'zustand'
import type { ProjectEntry, SessionSummary } from '../../../shared/ipc-contracts'
import type { ProjectTabKind, SavedProjectTab } from '../../../shared/project-tabs'
import { setProjectTabs } from '../../../shared/project-tabs'
import { projectKey, useSessionsStore } from './sessions'
import { splitWorktreeHostDir } from '../../../shared/worktree'

/** Проект центрального контента: активная сессия, иначе проект активной вкладки
 *  (файл/дифф/MCP/навыки/транскрипт несут свой проект). Для панелей Git/Files/MCP/Skills. */
export function useCenterProject(): ProjectEntry | null {
  const activeHostId = useSessionsStore((s) => s.activeHostId)
  const active = useSessionsStore((s) => s.active)
  const activeProjectKey = useTabsStore((s) => s.activeProjectKey)
  const entry = useTabsStore((s) => (s.activeProjectKey !== null ? s.byProject[s.activeProjectKey] : undefined))
  const sessionRow = active.find((r) => r.hostId === activeHostId) ?? null
  const sessionActive = sessionRow !== null && activeProjectKey !== null && parentTabKey(sessionRow.project) === activeProjectKey
  if (sessionActive) return sessionRow.project
  const tab = entry !== undefined ? entry.tabs.find((t) => tabId(t) === entry.activeId) : undefined
  return tab?.project ?? sessionRow?.project ?? (activeProjectKey !== null ? projectForKey(activeProjectKey) : null)
}

export type TabKind = 'file' | 'diff' | 'mcp' | 'skills' | 'transcript'

export interface ProjectTab {
  kind: TabKind
  project: ProjectEntry
  /** file/diff/transcript — путь; mcp/skills — вкладка одна на проект. */
  path?: string
  /** transcript — заголовок сессии. */
  title?: string
  /** transcript — полная сводка для TranscriptView. */
  summary?: SessionSummary
}

export interface ProjectTabs {
  tabs: ProjectTab[]
  activeId: string | null
}

export function tabId(tab: Pick<ProjectTab, 'kind' | 'path'>): string {
  return tab.path === undefined ? tab.kind : `${tab.kind}\u0000${tab.path}`
}

/** Ключ набора вкладок: у worktree-сессий вкладки живут в наборе родительского проекта. */
export function parentTabKey(project: ProjectEntry): string {
  const wt = splitWorktreeHostDir(project.dir)
  return projectKey(wt !== null ? { kind: project.kind, dir: wt.root } : project)
}

function projectForKey(key: string): ProjectEntry {
  const [kind, dir] = key.split('\u0000')
  return { kind: kind as ProjectEntry['kind'], dir }
}

let persistChain: Promise<void> = Promise.resolve()

function persist(key: string, tabs: ProjectTab[], activeId: string | null): void {
  persistChain = persistChain
    .then(async () => {
      const settings = useSessionsStore.getState().settings
      if (settings === null) return
      const saved: SavedProjectTab[] = tabs
        .filter((t) => t.kind !== 'transcript')
        .map((t): SavedProjectTab => (t.path !== undefined ? { kind: t.kind as ProjectTabKind, path: t.path } : { kind: t.kind as ProjectTabKind }))
      const index = saved.findIndex((t) => tabId(t) === activeId)
      const snapshot = index >= 0 ? { tabs: saved, activeIndex: index } : { tabs: saved }
      const next = await window.piwright.setSettings(setProjectTabs(settings, key, saved.length > 0 ? snapshot : null))
      useSessionsStore.getState().setSettings(next)
    })
    .catch(() => {})
}

function persistLastProject(key: string | null): void {
  persistChain = persistChain
    .then(async () => {
      const next = await window.piwright.setSettings({ lastProjectKey: key })
      useSessionsStore.getState().setSettings(next)
    })
    .catch(() => {})
}

/** hostId первой активной сессии проекта (для авто-активации вкладки чата). */
function firstSessionHost(key: string): string | null {
  return useSessionsStore.getState().active.find((r) => parentTabKey(r.project) === key)?.hostId ?? null
}

interface TabsState {
  activeProjectKey: string | null
  byProject: Record<string, ProjectTabs>
  /** Переключение набора вкладок проекта; снимок из settings гидратируется лениво. */
  setActiveProject: (key: string | null) => void
  /** Первый проект при старте: сохранённый lastProjectKey иначе проект активной сессии/первый в списке. */
  ensureInitialProject: () => void
  openTab: (project: ProjectEntry, tab: Omit<ProjectTab, 'project'>) => void
  /** Транскрипт сессии субагента как вкладка (не персистится). */
  openTranscript: (project: ProjectEntry, summary: SessionSummary) => void
  /** Клик по сессии: чат становится активным контентом (activeId сбрасывается). */
  activateSession: (project: ProjectEntry) => void
  closeTab: (project: ProjectEntry, id: string) => void
  setActive: (project: ProjectEntry, id: string) => void
  closeOthers: (project: ProjectEntry, id: string) => void
  closeAllOfType: (project: ProjectEntry, kind: TabKind) => void
  closeLeft: (project: ProjectEntry, id: string) => void
  closeRight: (project: ProjectEntry, id: string) => void
  forgetProject: (key: string) => void
}

export const useTabsStore = create<TabsState>((set, get) => ({
  activeProjectKey: null,
  byProject: {},

  setActiveProject: (key) => {
    if (get().activeProjectKey === key) return
    let entry: ProjectTabs = { tabs: [], activeId: null }
    if (key !== null) {
      const existing = get().byProject[key]
      if (existing !== undefined) {
        entry = existing
      } else {
        const snap = useSessionsStore.getState().settings?.projectTabs[key]
        if (snap !== undefined) {
          const tabs = snap.tabs.map((t) => ({ kind: t.kind, project: projectForKey(key), path: t.path }))
          entry = {
            tabs,
            activeId: snap.activeIndex !== undefined && snap.activeIndex < tabs.length ? tabId(tabs[snap.activeIndex]) : null
          }
        }
      }
    }
    set((state) => ({
      activeProjectKey: key,
      byProject: key === null ? state.byProject : { ...state.byProject, [key]: entry }
    }))
    void persistLastProject(key)
    if (key !== null && (entry.activeId === null || entry.tabs.every((t) => tabId(t) !== entry.activeId))) {
      const hostId = firstSessionHost(key)
      if (hostId !== null) useSessionsStore.getState().setActive(hostId)
    }
  },

  ensureInitialProject: () => {
    if (get().activeProjectKey !== null) return
    const st = useSessionsStore.getState()
    const saved = st.settings?.lastProjectKey ?? null
    const known =
      saved !== null &&
      (st.projects.some((p) => projectKey(p.project) === saved) || st.active.some((r) => parentTabKey(r.project) === saved))
    if (known) {
      get().setActiveProject(saved)
      return
    }
    const row = st.active.find((r) => r.hostId === st.activeHostId) ?? null
    const key = row !== null ? parentTabKey(row.project) : (st.projects[0] !== undefined ? parentTabKey(st.projects[0].project) : null)
    if (key !== null) get().setActiveProject(key)
  },

  openTab: (project, tab) => {
    const key = parentTabKey(project)
    const full: ProjectTab = { ...tab, project }
    const id = tabId(full)
    let tabs: ProjectTab[]
    set((state) => {
      const entry = state.byProject[key] ?? { tabs: [], activeId: null }
      tabs = entry.tabs.some((t) => tabId(t) === id) ? entry.tabs : [...entry.tabs, full]
      return { activeProjectKey: key, byProject: { ...state.byProject, [key]: { tabs, activeId: id } } }
    })
    persist(key, tabs!, id)
  },

  openTranscript: (project, summary) => {
    get().openTab(project, { kind: 'transcript', path: summary.path, title: summary.title, summary })
  },

  activateSession: (project) => {
    const key = parentTabKey(project)
    const entry = get().byProject[key]
    if (entry === undefined || entry.activeId === null) return
    set((state) => ({ byProject: { ...state.byProject, [key]: { ...entry, activeId: null } } }))
    persist(key, entry.tabs, null)
  },

  closeTab: (project, id) => {
    const key = parentTabKey(project)
    const entry = get().byProject[key]
    if (entry === undefined) return
    const index = entry.tabs.findIndex((t) => tabId(t) === id)
    if (index < 0) return
    const tabs = entry.tabs.filter((t) => tabId(t) !== id)
    let activeId = entry.activeId
    if (activeId === id) {
      const next = tabs[Math.min(index, tabs.length - 1)]
      activeId = next !== undefined ? tabId(next) : null
    }
    set((state) => ({ byProject: { ...state.byProject, [key]: { tabs, activeId } } }))
    persist(key, tabs, activeId)
    if (activeId === null) {
      const hostId = firstSessionHost(key)
      if (hostId !== null) useSessionsStore.getState().setActive(hostId)
    }
  },

  setActive: (project, id) => {
    const key = parentTabKey(project)
    const entry = get().byProject[key]
    if (entry === undefined || entry.tabs.every((t) => tabId(t) !== id)) return
    set((state) => ({ byProject: { ...state.byProject, [key]: { ...entry, activeId: id } } }))
    persist(key, entry.tabs, id)
  },

  closeOthers: (project, id) => {
    const key = parentTabKey(project)
    const entry = get().byProject[key]
    if (entry === undefined) return
    const tabs = entry.tabs.filter((t) => tabId(t) === id)
    set((state) => ({ byProject: { ...state.byProject, [key]: { tabs, activeId: id } } }))
    persist(key, tabs, id)
  },

  closeAllOfType: (project, kind) => {
    const key = parentTabKey(project)
    const entry = get().byProject[key]
    if (entry === undefined) return
    const tabs = entry.tabs.filter((t) => t.kind !== kind)
    const activeId = tabs.some((t) => tabId(t) === entry.activeId) ? entry.activeId : null
    set((state) => ({ byProject: { ...state.byProject, [key]: { tabs, activeId } } }))
    persist(key, tabs, activeId)
    if (activeId === null) {
      const hostId = firstSessionHost(key)
      if (hostId !== null) useSessionsStore.getState().setActive(hostId)
    }
  },

  closeLeft: (project, id) => {
    const key = parentTabKey(project)
    const entry = get().byProject[key]
    if (entry === undefined) return
    const index = entry.tabs.findIndex((t) => tabId(t) === id)
    if (index < 0) return
    const tabs = entry.tabs.slice(index)
    const activeId = tabs.some((t) => tabId(t) === entry.activeId) ? entry.activeId : id
    set((state) => ({ byProject: { ...state.byProject, [key]: { tabs, activeId } } }))
    persist(key, tabs, activeId)
  },

  closeRight: (project, id) => {
    const key = parentTabKey(project)
    const entry = get().byProject[key]
    if (entry === undefined) return
    const index = entry.tabs.findIndex((t) => tabId(t) === id)
    if (index < 0) return
    const tabs = entry.tabs.slice(0, index + 1)
    const activeId = tabs.some((t) => tabId(t) === entry.activeId) ? entry.activeId : id
    set((state) => ({ byProject: { ...state.byProject, [key]: { tabs, activeId } } }))
    persist(key, tabs, activeId)
  },

  forgetProject: (key) => {
    set((state) => {
      const byProject = { ...state.byProject }
      delete byProject[key]
      return { byProject, activeProjectKey: state.activeProjectKey === key ? null : state.activeProjectKey }
    })
  }
}))
