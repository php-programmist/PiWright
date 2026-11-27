import { create } from 'zustand'
import type { ProjectEntry, SessionSummary, SessionDot, Settings } from '../../../shared/ipc-contracts'
import { normalizeDir } from '../../../shared/worktree'
import { useChatStore } from './chat'
import { mruAlive, parentTabKey, tabId, useTabsStore } from './tabs'

/** Активная сессия панели: статус с main + флаг открытой вкладки. */
export interface SessionRow {
  hostId: string
  project: ProjectEntry
  title: string
  dot: SessionDot
  state: string
  /** pi session id после хендшейка — по нему активная сессия скрывается из истории. */
  sessionId: string | null
  /** Файл сессии (backend-путь) — по нему ищутся сессии субагентов. */
  sessionFile: string | null
  /** Telegram-уведомления сессии (иконка в шапке чата, флаг в RemoteBridge). */
  telegram: boolean
  /** Сессия расшарена на телефон глобусом (RemoteBridge, в памяти). */
  shared: boolean
  /** Фоновая сессия: вкладка закрыта крестиком при идущем ходе, агент работает — строка
   *  остаётся в панели с живым индикатором и play-иконкой аттача. */
  background: boolean
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
  /** Ширина панели проектов/сессий (переживает перезапуск, panels.sessions.width). */
  sidebarWidth: number
  /** Панель свернута в узкую полосу с суммарными бейджами (panels.sessions.open === false). */
  sidebarCollapsed: boolean
  setSidebarWidth: (width: number) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  settingsOpen: boolean
  openSettings: () => void
  closeSettings: () => void
  load: () => Promise<void>
  applyStatus: (status: import('../../../shared/ipc-contracts').PiStatus) => void
  forgetHost: (hostId: string) => void
  /** Сессия уходит в фон/возвращается (play-иконка, клик по строке): флаг + переключение активной вкладки. */
  setBackground: (hostId: string, background: boolean) => void
  /** Закрыть строку сессии: остановить процесс (keepAlive — отключиться, если есть чему жить),
   *  убрать чат и строку, обновить историю проекта. */
  closeSessionRow: (hostId: string, keepAlive: boolean) => Promise<void>
  setActive: (hostId: string | null) => void
  /** Тоггл telegram-уведомлений сессии (оптимистично, флаг живёт в main). */
  toggleTelegram: (hostId: string) => void
  /** Тоггл шаринга сессии на телефон (глобус; первый шаринг поднимает мост). */
  toggleShare: (hostId: string) => void
  addProject: (project: ProjectEntry) => Promise<void>
  removeProject: (project: ProjectEntry) => Promise<void>
  renameProject: (project: ProjectEntry, name: string) => Promise<void>
  /** Перестановка проекта в списке (drag-and-drop): index — позиция вставки в полном списке. */
  moveProject: (key: string, index: number) => void
  toggleExpanded: (key: string) => void
  refreshHistory: (project: ProjectEntry) => Promise<void>
  setShowAll: (key: string, showAll: boolean) => void
  setSettings: (settings: Settings) => void
  settings: Settings | null
}

export const HISTORY_PREVIEW_LIMIT = 3

export function projectKey(project: ProjectEntry): string {
  return `${project.kind}\u0000${normalizeDir(project.dir)}`
}

/** Активировать предыдущую вкладку/сессию проекта после ухода активной сессии: MRU → первая
 *  не-фоновая сессия проекта → первая вкладка проекта → первая не-фоновая сессия. Фоновые
 *  сессии (вкладка закрыта) не подхватываются — их открывает только явный клик/play. */
function activateNextAfter(hostId: string, project: ProjectEntry): void {
  const key = parentTabKey(project)
  const tabsStore = useTabsStore.getState()
  const prev = tabsStore.mru.find((e) => e.key === key && !(e.kind === 'session' && e.hostId === hostId) && mruAlive(e))
  if (prev !== undefined && tabsStore.activateMru(prev)) return
  const st = useSessionsStore.getState()
  const host = st.active.find((r) => !r.background && r.hostId !== hostId && parentTabKey(r.project) === key)?.hostId
  if (host !== undefined) {
    st.setActive(host)
    return
  }
  const tab = tabsStore.byProject[key]?.tabs[0]
  if (tab !== undefined) {
    tabsStore.setActiveProject(key)
    tabsStore.setActive(tab.project, tabId(tab))
    return
  }
  useSessionsStore.setState({ activeHostId: st.active.find((r) => !r.background)?.hostId ?? null })
}

export const useSessionsStore = create<SessionsState>((set, get) => ({
  projects: [],
  active: [],
  activeHostId: null,
  expanded: {},
  sidebarWidth: 280,
  sidebarCollapsed: false,
  settingsOpen: false,
  settings: null,

  setSidebarWidth: (width) => set({ sidebarWidth: Math.min(Math.max(Math.round(width), 220), 480) }),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  load: async () => {
    const [snapshot, settings] = await Promise.all([window.piwright.listSessions(), window.piwright.getSettings()])
    set((state) => ({
      active: snapshot.active.map((s) => ({
        hostId: s.hostId,
        project: s.project,
        title: s.title,
        dot: s.dot,
        state: s.state,
        sessionId: s.sessionId,
        sessionFile: s.sessionFile,
        telegram: s.telegram ?? false,
        shared: s.shared ?? false,
        background: false
      })),
      activeHostId: state.activeHostId ?? snapshot.active[0]?.hostId ?? null,
      settings,
      expanded: { ...state.expanded, ...settings.expandedProjects },
      projects: settings.projects.map((project) => {
        const existing = state.projects.find((p) => projectKey(p.project) === projectKey(project))
        return existing ?? { project, history: [], historyLoading: false, showAllHistory: false }
      })
    }))
    for (const row of get().projects) void get().refreshHistory(row.project)
  },

  applyStatus: (status) => {
    set((state) => {
      const active = state.active.filter((r) => r.hostId !== status.hostId)
      active.push({
        hostId: status.hostId,
        project: status.project,
        title: status.title,
        dot: status.dot,
        state: status.state,
        sessionId: status.sessionId,
        sessionFile: status.sessionFile,
        telegram: status.telegram ?? state.active.find((r) => r.hostId === status.hostId)?.telegram ?? false,
        shared: status.shared ?? state.active.find((r) => r.hostId === status.hostId)?.shared ?? false,
        background: state.active.find((r) => r.hostId === status.hostId)?.background ?? false
      })
      return { active }
    })
  },

  forgetHost: (hostId) => {
    const closedRow = get().active.find((r) => r.hostId === hostId)
    const wasActive = get().activeHostId === hostId
    set((state) => {
      const active = state.active.filter((r) => r.hostId !== hostId)
      return { active, activeHostId: wasActive ? null : state.activeHostId }
    })
    useTabsStore.getState().pruneMru()
    if (!wasActive || closedRow === undefined) return
    activateNextAfter(hostId, closedRow.project)
  },

  setBackground: (hostId, background) => {
    const row = get().active.find((r) => r.hostId === hostId)
    if (row === undefined || row.background === background) return
    set((state) => ({ active: state.active.map((r) => (r.hostId === hostId ? { ...r, background } : r)) }))
    if (!background) return
    // Вкладка закрыта: если сессия была активной — переключиться на предыдущую (как forgetHost).
    useTabsStore.getState().pruneMru()
    if (get().activeHostId !== hostId) return
    set({ activeHostId: null })
    activateNextAfter(hostId, row.project)
  },

  closeSessionRow: async (hostId, keepAlive) => {
    const row = get().active.find((r) => r.hostId === hostId)
    await window.piwright.closeSession(hostId, keepAlive)
    useChatStore.getState().removeHost(hostId)
    get().forgetHost(hostId)
    if (row !== undefined) void get().refreshHistory(row.project)
  },

  setActive: (hostId) => {
    // Явная активация (клик по строке/вкладке, play) возвращает сессию из фона — вкладка открывается.
    if (hostId !== null && get().active.find((r) => r.hostId === hostId)?.background === true) {
      set((state) => ({ active: state.active.map((r) => (r.hostId === hostId ? { ...r, background: false } : r)) }))
    }
    set({ activeHostId: hostId })
    if (hostId !== null) useTabsStore.getState().touchSession(hostId)
  },

  toggleTelegram: (hostId) => {
    const row = get().active.find((r) => r.hostId === hostId)
    if (row === undefined) return
    const enabled = !row.telegram
    set((state) => ({ active: state.active.map((r) => (r.hostId === hostId ? { ...r, telegram: enabled } : r)) }))
    void window.piwright.setSessionTelegram(hostId, enabled)
  },

  toggleShare: (hostId) => {
    const row = get().active.find((r) => r.hostId === hostId)
    if (row === undefined) return
    const shared = !row.shared
    set((state) => ({ active: state.active.map((r) => (r.hostId === hostId ? { ...r, shared } : r)) }))
    // Первый шаринг поднимает мост (решение юзера: сервер — на первую remote-вкладку; не гасится).
    const settings = get().settings
    if (shared && settings !== null && !settings.notifications.remote.enabled) {
      void window.piwright
        .setSettings({ notifications: { ...settings.notifications, remote: { ...settings.notifications.remote, enabled: true } } })
        .then((saved) => get().setSettings(saved))
    }
    void window.piwright.shareSession(hostId, shared)
  },

  addProject: async (project) => {
    const settings = await window.piwright.setSettings({ projects: [...get().projects.map((p) => p.project), project] })
    set((state) => ({
      settings,
      projects: settings.projects.map((p) => {
        const existing = state.projects.find((x) => projectKey(x.project) === projectKey(p))
        return existing ?? { project: p, history: [], historyLoading: false, showAllHistory: false }
      })
    }))
    void get().refreshHistory(project)
  },

  removeProject: async (project) => {
    const key = projectKey(project)
    const settings = await window.piwright.setSettings({
      projects: get().projects.map((p) => p.project).filter((p) => projectKey(p) !== key),
      projectDbConnections: Object.fromEntries(
        Object.entries(get().settings?.projectDbConnections ?? {}).filter(([k]) => k !== key)
      )
    })
    set((state) => ({
      settings,
      projects: state.projects.filter((p) => projectKey(p.project) !== key)
    }))
  },

  renameProject: async (project, name) => {
    const trimmed = name.trim()
    const projects = get().projects.map((p) =>
      projectKey(p.project) === projectKey(project)
        ? { ...p, project: { ...p.project, name: trimmed.length > 0 ? trimmed : undefined } }
        : p
    )
    const settings = await window.piwright.setSettings({ projects: projects.map((p) => p.project) })
    set({ settings, projects: settings.projects.map((p) => {
      const existing = projects.find((x) => projectKey(x.project) === projectKey(p))
      return existing ?? { project: p, history: [], historyLoading: false, showAllHistory: false }
    }) })
  },

  moveProject: (key, index) => {
    const projects = get().projects
    const pos = projects.findIndex((p) => projectKey(p.project) === key)
    if (pos === -1) return
    const next = [...projects]
    const [row] = next.splice(pos, 1)
    // index посчитан по полному списку; после удаления перетаскиваемого сдвигаем на 1
    const insertAt = Math.max(0, Math.min(pos < index ? index - 1 : index, next.length))
    next.splice(insertAt, 0, row)
    set({ projects: next })
    void window.piwright.setSettings({ projects: next.map((p) => p.project) }).then((saved) => set({ settings: saved }))
  },

  toggleExpanded: (key) => {
    const expanded = { ...get().expanded, [key]: !(get().expanded[key] ?? false) }
    set({ expanded })
    void window.piwright.setSettings({ expandedProjects: expanded })
  },

  refreshHistory: async (project) => {
    const key = projectKey(project)
    const existing = get().projects.find((p) => projectKey(p.project) === key)
    // история уже показана — обновляем молча, чтобы список не дёргался на лоадере
    const silent = existing !== undefined && existing.history.length > 0
    if (!silent) {
      set((state) => ({
        projects: state.projects.map((p) => (projectKey(p.project) === key ? { ...p, historyLoading: true } : p))
      }))
    }
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
