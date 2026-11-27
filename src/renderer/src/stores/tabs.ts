/** Вкладки проектов в центре workspace: сессии (производные от активных), файлы, диффы,
 *  MCP, навыки, транскрипты. Сессии и транскрипты в settings не пишутся (сессии не
 *  возобновляются при открытии проекта), остальные — снимком в Settings.projectTabs. */
import { create } from 'zustand'
import type { ProjectEntry, SessionSummary } from '../../../shared/ipc-contracts'
import type { ProjectTabKind, SavedProjectTab } from '../../../shared/project-tabs'
import { setProjectTabs } from '../../../shared/project-tabs'
import { projectKey, projectForKey, useSessionsStore } from './sessions'
import { splitWorktreeHostDir } from '../../../shared/worktree'

/** Проект центрального контента: активная сессия, иначе проект активной вкладки
 *  (файл/дифф/MCP/навыки/транскрипт несут свой проект). Для панелей Git/Files/MCP/Skills. */
export function useCenterProject(): ProjectEntry | null {
  const activeHostId = useSessionsStore((s) => s.activeHostId)
  const active = useSessionsStore((s) => s.active)
  const projects = useSessionsStore((s) => s.projects)
  const activeProjectKey = useTabsStore((s) => s.activeProjectKey)
  const entry = useTabsStore((s) => (s.activeProjectKey !== null ? s.byProject[s.activeProjectKey] : undefined))
  const sessionRow = active.find((r) => r.hostId === activeHostId) ?? null
  const sessionActive = sessionRow !== null && activeProjectKey !== null && parentTabKey(sessionRow.project) === activeProjectKey
  if (sessionActive) return sessionRow.project
  const tab = entry !== undefined ? entry.tabs.find((t) => tabId(t) === entry.activeId) : undefined
  // Fallback — только проект активного набора вкладок: чужая активная сессия (другого
  // проекта) сюда попадать не должна, иначе панели центра показывают не тот проект.
  // real — из списка проектов/активных сессий: у него исходный dir (UNC для WSL) и serverId;
  // tab?.project у восстановленных из settings вкладок реконструирован по ключу и неполон.
  if (activeProjectKey === null) return null
  const real =
    projects.find((p) => projectKey(p.project) === activeProjectKey)?.project ??
    active.find((r) => parentTabKey(r.project) === activeProjectKey)?.project ??
    null
  return real ?? tab?.project ?? projectForKey(activeProjectKey)
}

export type TabKind =
  | 'file'
  | 'diff'
  | 'tool-diff'
  | 'mcp'
  | 'skills'
  | 'kanban'
  | 'task'
  | 'transcript'
  | 'db-table'
  | 'db-console'
  | 'db-settings'

export interface ProjectTab {
  kind: TabKind
  project: ProjectEntry
  /** file/diff/transcript/tool-diff — путь; mcp/skills — вкладка одна на проект. */
  path?: string
  /** diff — хеш коммита (дифф файла в коммите из истории Git). */
  hash?: string
  /** kanban/task — id доски. */
  boardId?: string
  /** task — id карточки. */
  taskId?: string
  /** db-table — подключение/схема/таблица дерева БД; db-console — подключение консоли. */
  connectionId?: string
  schema?: string
  table?: string
  /** transcript/kanban/task — заголовок (сессии / доски / задачи). */
  title?: string
  /** transcript — полная сводка для TranscriptView. */
  summary?: SessionSummary
}

export interface ProjectTabs {
  tabs: ProjectTab[]
  activeId: string | null
}

/** Запись MRU-истории вкладок: сессия (hostId) или вкладка проекта (tabId). */
export type MruEntry =
  | { kind: 'session'; hostId: string; key: string }
  | { kind: 'tab'; key: string; id: string }

export const MRU_LIMIT = 10

export function mruIdent(entry: MruEntry): string {
  return entry.kind === 'session' ? `s:${entry.hostId}` : `t:${entry.key}:${entry.id}`
}

/** Жива ли запись MRU: сессия ещё открыта и не в фоне (вкладка закрыта) / вкладка ещё существует. */
export function mruAlive(entry: MruEntry): boolean {
  if (entry.kind === 'session') {
    const row = useSessionsStore.getState().active.find((r) => r.hostId === entry.hostId)
    return row !== undefined && !row.background
  }
  return useTabsStore.getState().byProject[entry.key]?.tabs.some((t) => tabId(t) === entry.id) ?? false
}

export function tabId(tab: Pick<ProjectTab, 'kind' | 'path' | 'hash' | 'boardId' | 'taskId' | 'connectionId' | 'schema' | 'table'>): string {
  if (tab.path !== undefined) {
    return tab.hash === undefined ? `${tab.kind}\u0000${tab.path}` : `${tab.kind}\u0000${tab.path}\u0000${tab.hash}`
  }
  if (tab.boardId !== undefined) {
    return tab.taskId === undefined ? `${tab.kind}\u0000${tab.boardId}` : `${tab.kind}\u0000${tab.boardId}\u0000${tab.taskId}`
  }
  if (tab.connectionId !== undefined) {
    return `${tab.kind}\u0000${tab.connectionId}\u0000${tab.schema}\u0000${tab.table}`
  }
  return tab.kind
}

/** Ключ набора вкладок: у worktree-сессий вкладки живут в наборе родительского проекта. */
export function parentTabKey(project: ProjectEntry): string {
  const wt = splitWorktreeHostDir(project.dir)
  return projectKey(wt !== null ? { kind: project.kind, dir: wt.root } : project)
}

let persistChain: Promise<void> = Promise.resolve()

function persist(key: string, tabs: ProjectTab[], activeId: string | null): void {
  persistChain = persistChain
    .then(async () => {
      const settings = useSessionsStore.getState().settings
      if (settings === null) return
      const saved: SavedProjectTab[] = tabs
        .filter((t) => t.kind !== 'transcript' && t.kind !== 'tool-diff')
        .map((t): SavedProjectTab => {
          const savedTab: SavedProjectTab =
            t.path !== undefined ? { kind: t.kind as ProjectTabKind, path: t.path } : { kind: t.kind as ProjectTabKind }
          if (t.hash !== undefined) savedTab.hash = t.hash
          if (t.boardId !== undefined) savedTab.boardId = t.boardId
          if (t.taskId !== undefined) savedTab.taskId = t.taskId
          if (t.connectionId !== undefined) savedTab.connectionId = t.connectionId
          if (t.schema !== undefined) savedTab.schema = t.schema
          if (t.table !== undefined) savedTab.table = t.table
          if (t.title !== undefined && (t.kind === 'kanban' || t.kind === 'task' || t.kind === 'db-table' || t.kind === 'db-console' || t.kind === 'db-settings')) savedTab.title = t.title
          return savedTab
        })
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

/** hostId первой не-фоновой сессии проекта (для авто-активации вкладки чата). */
function firstSessionHost(key: string): string | null {
  return useSessionsStore.getState().active.find((r) => !r.background && parentTabKey(r.project) === key)?.hostId ?? null
}

interface TabsState {
  activeProjectKey: string | null
  byProject: Record<string, ProjectTabs>
  /** MRU открытых вкладок (сессии + вкладки проектов, все проекты, до MRU_LIMIT). В памяти. */
  mru: MruEntry[]
  /** Запомнить активацию сессии (hostId должен быть в sessions.active). */
  touchSession: (hostId: string) => void
  /** Запомнить активацию вкладки проекта. */
  touchTab: (project: ProjectEntry, id: string) => void
  /** Убрать из MRU мёртвые записи (закрытые сессии/вкладки). */
  pruneMru: () => void
  /** Активировать запись MRU (переключить проект + вкладку/сессию); false — запись мертва. */
  activateMru: (entry: MruEntry) => boolean
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
  /** Закрыть канбан-вкладки (доски и задачи) во всех проектах (при выключенном kanbanEnabled). */
  purgeKanbanTabs: () => void
  forgetProject: (key: string) => void
}

export const useTabsStore = create<TabsState>((set, get) => ({
  activeProjectKey: null,
  byProject: {},
  mru: [],

  touchSession: (hostId) => {
    const row = useSessionsStore.getState().active.find((r) => r.hostId === hostId)
    if (row === undefined) return
    const entry: MruEntry = { kind: 'session', hostId, key: parentTabKey(row.project) }
    set((state) => ({ mru: [entry, ...state.mru.filter((e) => mruIdent(e) !== mruIdent(entry))].slice(0, MRU_LIMIT) }))
  },

  touchTab: (project, id) => {
    const entry: MruEntry = { kind: 'tab', key: parentTabKey(project), id }
    set((state) => ({ mru: [entry, ...state.mru.filter((e) => mruIdent(e) !== mruIdent(entry))].slice(0, MRU_LIMIT) }))
  },

  pruneMru: () => {
    set((state) => ({ mru: state.mru.filter(mruAlive) }))
  },

  activateMru: (entry) => {
    if (entry.kind === 'session') {
      const sessions = useSessionsStore.getState()
      const row = sessions.active.find((r) => r.hostId === entry.hostId)
      if (row === undefined) return false
      get().setActiveProject(entry.key)
      get().activateSession(row.project)
      sessions.setActive(entry.hostId)
      return true
    }
    const tab = get().byProject[entry.key]?.tabs.find((t) => tabId(t) === entry.id)
    if (tab === undefined) return false
    get().setActiveProject(entry.key)
    get().setActive(tab.project, entry.id)
    return true
  },

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
          const kanbanOn = useSessionsStore.getState().settings?.kanbanEnabled ?? false
          const restored = snap.tabs.map((t) => ({
            kind: t.kind,
            project: projectForKey(key),
            path: t.path,
            ...(t.hash !== undefined ? { hash: t.hash } : {}),
            ...(t.boardId !== undefined ? { boardId: t.boardId } : {}),
            ...(t.taskId !== undefined ? { taskId: t.taskId } : {}),
            ...(t.connectionId !== undefined ? { connectionId: t.connectionId } : {}),
            ...(t.schema !== undefined ? { schema: t.schema } : {}),
            ...(t.table !== undefined ? { table: t.table } : {}),
            ...(t.title !== undefined ? { title: t.title } : {})
          }))
          const savedActiveId = snap.activeIndex !== undefined && snap.activeIndex < restored.length ? tabId(restored[snap.activeIndex]) : null
          const tabs = kanbanOn ? restored : restored.filter((t) => t.kind !== 'kanban' && t.kind !== 'task')
          entry = { tabs, activeId: savedActiveId !== null && tabs.some((t) => tabId(t) === savedActiveId) ? savedActiveId : null }
        }
      }
    }
    set((state) => ({
      activeProjectKey: key,
      byProject: key === null ? state.byProject : { ...state.byProject, [key]: entry }
    }))
    if (key !== null && entry.activeId !== null && entry.tabs.some((t) => tabId(t) === entry.activeId)) {
      get().touchTab(projectForKey(key), entry.activeId)
    }
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
    get().touchTab(project, id)
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
    let mruSessionHost: string | null = null
    if (activeId === id) {
      // Предыдущая активная вкладка этого же проекта из MRU; иначе сосед справа (старое поведение).
      const prev = get().mru.find((e) => e.key === key && !(e.kind === 'tab' && e.id === id) && mruAlive(e))
      if (prev !== undefined && prev.kind === 'tab') {
        activeId = prev.id
      } else if (prev !== undefined) {
        activeId = null
        mruSessionHost = prev.hostId
      } else {
        const next = tabs[Math.min(index, tabs.length - 1)]
        activeId = next !== undefined ? tabId(next) : null
      }
    }
    set((state) => ({ byProject: { ...state.byProject, [key]: { tabs, activeId } } }))
    persist(key, tabs, activeId)
    get().pruneMru()
    if (activeId !== null && mruSessionHost === null && entry.activeId === id) get().touchTab(projectForKey(key), activeId)
    if (mruSessionHost !== null) useSessionsStore.getState().setActive(mruSessionHost)
    if (activeId === null && mruSessionHost === null) {
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
    get().touchTab(project, id)
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

  purgeKanbanTabs: () => {
    if (useSessionsStore.getState().settings?.kanbanEnabled ?? false) return
    for (const [key, entry] of Object.entries(get().byProject)) {
      for (const kind of ['kanban', 'task'] as const) {
        if (entry.tabs.some((t) => t.kind === kind)) get().closeAllOfType(projectForKey(key), kind)
      }
    }
  },

  forgetProject: (key) => {
    set((state) => {
      const byProject = { ...state.byProject }
      delete byProject[key]
      return { byProject, activeProjectKey: state.activeProjectKey === key ? null : state.activeProjectKey }
    })
  }
}))
