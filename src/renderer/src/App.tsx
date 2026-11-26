import { useEffect, useRef } from 'react'
import { SessionsPanel } from './components/SessionsPanel'
import { TabBar } from './components/TabBar'
import { AppHeader } from './components/AppHeader'
import { GitPanel } from './views/git/GitPanel'
import { DiffOverlay } from './views/git/DiffOverlay'
import { FilesPanel } from './views/files/FilesPanel'
import { FileViewer } from './views/files/FileViewer'
import { TerminalPanel } from './views/terminal/TerminalPanel'
import { GitLogPanel } from './views/git/GitLogPanel'
import { KanbanPanel } from './views/kanban/KanbanPanel'
import { BoardView } from './views/kanban/BoardView'
import { TaskView } from './views/kanban/TaskView'
import { termWrite, termWriteExit } from './views/terminal/term-registry'
import { ChatView } from './views/chat/ChatView'
import { TranscriptView } from './views/chat/TranscriptView'
import { McpView } from './views/mcp/McpView'
import { SkillsView } from './views/skills/SkillsView'
import { SettingsView } from './views/settings/SettingsView'
import { StatsView } from './views/stats/StatsView'
import { ConfirmDialogHost, confirmDialog } from './components/ConfirmDialog'
import { RenameDialogHost } from './components/RenameDialog'
import { ResolveConflictsDialog } from './components/ResolveConflictsDialog'
import { TabSwitcherHost } from './components/TabSwitcher'
import { SearchEverywhereHost } from './components/SearchEverywhere'
import { useChatStore, atBottomMap } from './stores/chat'
import { useFilesStore } from './stores/files'
import { useGitStore } from './stores/git'
import { useSessionsStore, projectKey } from './stores/sessions'
import { parentTabKey, tabId, useTabsStore, useCenterProject } from './stores/tabs'
import { useTerminalStore } from './stores/terminal'
import { useGitLogStore } from './stores/gitlog'
import { useKanbanStore } from './stores/kanban'
import { useScheduledStore } from './stores/scheduled'
import { useStatsStore } from './stores/stats'
import { hydratePanels, persistPanel } from './stores/panels-prefs'
import { closeSessionAndSweepWorktree } from './lib/worktree-cleanup'
import { applyAppearance, applyKanbanTheme } from './lib/appearance'
import { useKanbanThemeStore } from './stores/kanban-theme'
import { KANBAN_DEFAULT_THEME_ID, resolveKanbanTheme } from '../../shared/kanban-theme'
import { useT } from './lib/i18n'
import { playNotificationSound } from './lib/sounds'

export function App(): React.JSX.Element {
  const t = useT()
  const applyEvent = useChatStore((s) => s.applyEvent)
  const applyChatStatus = useChatStore((s) => s.applyStatus)
  const applySessionsStatus = useSessionsStore((s) => s.applyStatus)
  const load = useSessionsStore((s) => s.load)
  const activeHostId = useSessionsStore((s) => s.activeHostId)
  const settingsOpen = useSessionsStore((s) => s.settingsOpen)
  const statsOpen = useStatsStore((s) => s.open)
  const gitOpen = useGitStore((s) => s.open)
  const filesOpen = useFilesStore((s) => s.open)
  const termOpen = useTerminalStore((s) => s.open)
  const gitLogOpen = useGitLogStore((s) => s.open)
  const kanbanOpen = useKanbanStore((s) => s.open)
  const settings = useSessionsStore((s) => s.settings)
  const activeProjectKey = useTabsStore((s) => s.activeProjectKey)
  const tabEntry = useTabsStore((s) => (s.activeProjectKey !== null ? s.byProject[s.activeProjectKey] : undefined))
  const activeAll = useSessionsStore((s) => s.active)
  const projects = useSessionsStore((s) => s.projects)
  const hydratedRef = useRef(false)
  const theme = settings?.theme ?? 'dark'
  const chatFontSize = settings?.chatFontSize ?? 14

  useEffect(() => {
    applyAppearance(theme, chatFontSize)
  }, [theme, chatFontSize])

  // Правка models.json вне приложения: вернулись в окно — перечитать каталог моделей у живых сессий.
  useEffect(() => {
    const refreshModels = (): void => {
      if (document.visibilityState === 'visible') void window.piwright.modelsRefresh().catch(() => {})
    }
    window.addEventListener('focus', refreshModels)
    document.addEventListener('visibilitychange', refreshModels)
    return () => {
      window.removeEventListener('focus', refreshModels)
      document.removeEventListener('visibilitychange', refreshModels)
    }
  }, [])

  // Тема канбана: своя палитра колонок/карточек в CSS-переменных; при выключенном канбане — системные цвета.
  const kanbanEnabled = settings?.kanbanEnabled ?? false
  const kanbanThemeId = settings?.kanbanTheme ?? KANBAN_DEFAULT_THEME_ID
  const customKanbanThemes = useKanbanThemeStore((s) => s.custom)
  useEffect(() => {
    if (kanbanEnabled && !useKanbanThemeStore.getState().loaded) void useKanbanThemeStore.getState().load()
  }, [kanbanEnabled])
  useEffect(() => {
    applyKanbanTheme(kanbanEnabled ? resolveKanbanTheme(customKanbanThemes, kanbanThemeId) : null)
  }, [kanbanEnabled, kanbanThemeId, customKanbanThemes])

  // Канбан выключен — убрать канбан-вкладки из всех проектов.
  useEffect(() => {
    if (settings !== null && !settings.kanbanEnabled) useTabsStore.getState().purgeKanbanTabs()
  }, [settings?.kanbanEnabled])

  useEffect(() => {
    if (settings === null || hydratedRef.current) return
    hydratedRef.current = true
    hydratePanels(settings)
  }, [settings])

  // Первый активный проект: после загрузки сессий/настроек (один раз).
  const sessionsLoaded = useSessionsStore((s) => s.settings !== null)
  useEffect(() => {
    if (sessionsLoaded) useTabsStore.getState().ensureInitialProject()
  }, [sessionsLoaded, activeAll.length, projects.length])

  // MCP/навыки — вкладки проекта: тоггл из вертикальной панели справа.
  const toggleCenterTab = (kind: 'mcp' | 'skills'): void => {
    const tabsStore = useTabsStore.getState()
    const key = tabsStore.activeProjectKey
    if (key === null) return
    const entry = tabsStore.byProject[key]
    const existing = entry?.tabs.find((tab) => tab.kind === kind)
    if (existing !== undefined && entry.activeId === tabId(existing)) {
      tabsStore.closeTab(existing.project, tabId(existing))
      return
    }
    const st = useSessionsStore.getState()
    // Проект набора вкладок (key), не глобально активной сессии: чужая активная сессия
    // другого проекта не должна подменять проект MCP/навыков.
    const project =
      st.projects.find((p) => projectKey(p.project) === key)?.project ??
      st.active.find((r) => parentTabKey(r.project) === key)?.project ??
      existing?.project
    if (project === undefined) return
    tabsStore.openTab(project, { kind })
  }

  // Git и Files делят одно пространство: открытие одного закрывает другое (фича 24).
  const toggleGit = (): void => {
    useGitStore.getState().toggleOpen()
    if (useGitStore.getState().open && useFilesStore.getState().open) {
      useFilesStore.getState().toggleOpen()
      persistPanel('files', { open: false })
    }
    if (useGitStore.getState().open && useKanbanStore.getState().open) {
      useKanbanStore.getState().toggleOpen()
      persistPanel('kanban', { open: false })
    }
    persistPanel('git', { open: useGitStore.getState().open })
  }
  const toggleFiles = (): void => {
    useFilesStore.getState().toggleOpen()
    if (useFilesStore.getState().open && useGitStore.getState().open) {
      useGitStore.getState().toggleOpen()
      persistPanel('git', { open: false })
    }
    if (useFilesStore.getState().open && useKanbanStore.getState().open) {
      useKanbanStore.getState().toggleOpen()
      persistPanel('kanban', { open: false })
    }
    persistPanel('files', { open: useFilesStore.getState().open })
  }
  // Канбан делит правый рельс с git/files: открытие закрывает обе.
  const toggleKanban = (): void => {
    useKanbanStore.getState().toggleOpen()
    if (useKanbanStore.getState().open) {
      if (useGitStore.getState().open) {
        useGitStore.getState().toggleOpen()
        persistPanel('git', { open: false })
      }
      if (useFilesStore.getState().open) {
        useFilesStore.getState().toggleOpen()
        persistPanel('files', { open: false })
      }
    }
    persistPanel('kanban', { open: useKanbanStore.getState().open })
  }
  const toggleTerm = (): void => {
    useTerminalStore.getState().toggleOpen()
    // История Git и терминал делят нижний док: открытие одного сворачивает другое.
    if (useTerminalStore.getState().open && useGitLogStore.getState().open) {
      useGitLogStore.getState().toggleOpen()
      persistPanel('gitlog', { open: false })
    }
    persistPanel('terminal', { open: useTerminalStore.getState().open })
    // Первое открытие терминала на проекте: сохранённые вкладки (фича 37) или дефолтная (фича 36).
    if (!useTerminalStore.getState().open) return
    const project = centerProject
    if (project === null) return
    useTerminalStore.getState().ensureTabs(project)
  }
  const toggleGitLog = (): void => {
    useGitLogStore.getState().toggleOpen()
    if (useGitLogStore.getState().open && useTerminalStore.getState().open) {
      useTerminalStore.getState().toggleOpen()
      persistPanel('terminal', { open: false })
    }
    persistPanel('gitlog', { open: useGitLogStore.getState().open })
    if (!useGitLogStore.getState().open) return
    const st = useSessionsStore.getState()
    const project = st.active.find((r) => r.hostId === st.activeHostId)?.project ?? null
    if (project !== null) void useGitLogStore.getState().refresh(project)
  }
  const chat = useChatStore((s) => (activeHostId !== null ? s.hosts[activeHostId] : undefined))
  const centerProject = useCenterProject()
  const sessionRows = activeProjectKey !== null ? activeAll.filter((r) => parentTabKey(r.project) === activeProjectKey) : []
  const sessionActive = sessionRows.some((r) => r.hostId === activeHostId) && (tabEntry?.activeId ?? null) === null
  const activeTab = !sessionActive && tabEntry !== undefined ? (tabEntry.tabs.find((tab) => tabId(tab) === tabEntry.activeId) ?? null) : null
  const closeActiveTab = (): void => {
    if (activeTab !== null) useTabsStore.getState().closeTab(activeTab.project, tabId(activeTab))
  }

  useEffect(() => {
    const offEvent = window.piwright.onPiEvent((message) => {
      applyEvent(message)
      const event = message.event
      if (event.type === 'turn_end' || event.type === 'dialog_open' || event.type === 'turn_error' || (event.type === 'notify' && event.isError)) {
        const kind = event.type === 'turn_end' ? 'completion' : event.type === 'dialog_open' ? 'await' : 'error'
        // Check-ход петли — служебный, без звука; ход с ошибкой уже дал звук turn_error.
        if (!(event.type === 'turn_end' && (event.check === true || event.error != null))) {
          playNotificationSound(
            message.hostId,
            kind,
            useSessionsStore.getState().settings?.notifications.sounds,
            useChatStore.getState().hosts[message.hostId]?.muted ?? false
          )
        }
      }
      // Петля перешла на новую сессию: если юзер смотрел прошлую — следуем за петлёй.
      if (message.event.type === 'loop_state' && message.event.info.active && message.event.previousHostId !== null) {
        useChatStore.getState().carryOverLoopFlags(message.event.previousHostId, message.hostId)
        const st = useSessionsStore.getState()
        if (st.activeHostId === message.event.previousHostId) st.setActive(message.hostId)
        // Чекбокс «Закрывать сессию после завершения цикла»: родительская вкладка закрывается.
        if (st.settings?.loopCloseSession === true) {
          const prev = message.event.previousHostId
          void closeSessionAndSweepWorktree(prev, false)
        }
      }
      if (message.event.type !== 'turn_end') return
      const watching = useSessionsStore.getState().activeHostId === message.hostId && atBottomMap.get(message.hostId) === true
      if (!watching) useChatStore.getState().markUnread(message.hostId)
      const row = useSessionsStore.getState().active.find((r) => r.hostId === message.hostId)
      if (row !== undefined) void useGitStore.getState().refreshStatus(row.project, true)
    })
    const offStatus = window.piwright.onPiStatus((status) => {
      applyChatStatus(status)
      applySessionsStatus(status)
    })
    const offFilesChanged = window.piwright.onFilesChanged((message) => {
      void useFilesStore.getState().applyFileChanged(message.project, message.path)
    })
    const offTermData = window.piwright.onTermData((message) => termWrite(message.id, message.data))
    const offTermExit = window.piwright.onTermExit((message) => {
      termWriteExit(message.id, message.code)
      useTerminalStore.getState().applyExit(message.id, message.code)
    })
    const offMenuSettings = window.piwright.onMenuSettings(() => useSessionsStore.getState().openSettings())
    const offMenuStats = window.piwright.onMenuStats(() => useStatsStore.getState().openModal())
    const offScheduled = window.piwright.onScheduledChanged(() => void useScheduledStore.getState().refresh())
    // Version-skew: демон от старой версии пережил обновление — остановить детей или продолжить.
    const offDaemonSkew = window.piwright.onDaemonSkew((info) => {
      void confirmDialog({
        message: t(
          'Background sessions from version {version} are running. Stop them (agents will be interrupted) or continue as is?',
          { version: info.daemonAppVersion || `proto ${info.daemonProto}` }
        ),
        confirmLabel: t('Stop sessions'),
        danger: true
      }).then((stop) => {
        void window.piwright.resolveVersionSkew(stop)
      })
    })
    void useScheduledStore.getState().refresh()
    void load()
    void window.piwright.getPendingDialogs().then((pending) => {
      for (const p of pending) applyEvent({ hostId: p.hostId, event: { type: 'dialog_open', id: p.id, dialog: p.dialog } })
    })
    // Состояния петель, восстановленных до создания окна (recovery-вкладки при старте):
    // их loop_state ушел в пустоту — дотягиваем снимком на маунте, как pending-диалоги.
    void window.piwright.loopsSnapshot().then((loops) => {
      for (const { hostId, info } of loops) applyEvent({ hostId, event: { type: 'loop_state', info, previousHostId: null } })
    })
    return () => {
      offEvent()
      offStatus()
      offFilesChanged()
      offTermData()
      offTermExit()
      offMenuSettings()
      offMenuStats()
      offScheduled()
      offDaemonSkew()
    }
  }, [applyEvent, applyChatStatus, applySessionsStatus, load, t])

  return (
    <div className="app">
      <AppHeader />
      <ConfirmDialogHost />
      <ResolveConflictsDialog />
      <RenameDialogHost />
      <TabSwitcherHost />
      <SearchEverywhereHost />
      {settingsOpen && <SettingsView />}
      {statsOpen && <StatsView />}
      {(
        <div className="layout">
          <SessionsPanel />
          <div className="workspace">
            <div className="content-row">
              <div className="chat-column">
                <TabBar />
                {sessionActive ? (
                  <ChatView key={activeHostId ?? 'none'} chat={chat ?? null} />
                ) : activeTab === null ? (
                  <div className="center-empty" />
                ) : activeTab.kind === 'file' ? (
                  <FileViewer key={activeTab.path} tab={activeTab} />
                ) : activeTab.kind === 'diff' ? (
                  <DiffOverlay key={tabId(activeTab)} tab={activeTab} />
                ) : activeTab.kind === 'kanban' ? (
                  <BoardView key={tabId(activeTab)} tab={activeTab} />
                ) : activeTab.kind === 'task' ? (
                  <TaskView key={tabId(activeTab)} tab={activeTab} />
                ) : activeTab.kind === 'mcp' ? (
                  <McpView key={tabId(activeTab)} tab={activeTab} onClose={closeActiveTab} />
                ) : activeTab.kind === 'skills' ? (
                  <SkillsView key={tabId(activeTab)} tab={activeTab} onClose={closeActiveTab} />
                ) : (
                  <TranscriptView key={activeTab.path} project={activeTab.project} summary={activeTab.summary!} />
                )}
              </div>
              <div className="right-side">
                {gitOpen && <GitPanel />}
                {filesOpen && <FilesPanel />}
                {settings?.kanbanEnabled && kanbanOpen && <KanbanPanel />}
              </div>
            </div>
            {termOpen && <TerminalPanel />}
            {gitLogOpen && <GitLogPanel />}
          </div>
          <div className="right-bar">
            <button className={gitOpen ? 'active' : ''} title={t('Git')} onClick={toggleGit}>
              <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
                <line x1="1" y1="8" x2="15" y2="8" stroke="currentColor" strokeWidth="1.4" />
                <circle cx="8" cy="8" r="3.2" fill="var(--panel-bg)" stroke="currentColor" strokeWidth="1.4" />
              </svg>
            </button>
            <button className={filesOpen ? 'active' : ''} title={t('Files')} onClick={toggleFiles}>
              <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M1.5 3.5h4.6l1.4 1.8h7v7.2h-13z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            {settings?.kanbanEnabled && (
              <button className={kanbanOpen ? 'active' : ''} title={t('Kanban')} onClick={toggleKanban}>
                <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="1.5" y="2.5" width="3.6" height="11" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
                  <rect x="6.2" y="2.5" width="3.6" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
                  <rect x="10.9" y="2.5" width="3.6" height="11" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
                </svg>
              </button>
            )}
            <button
              className={activeTab?.kind === 'mcp' ? 'active' : ''}
              title={t('MCP servers')}
              onClick={() => toggleCenterTab('mcp')}
            >
              <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
                <rect x="1.5" y="1.5" width="13" height="5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
                <rect x="1.5" y="9.5" width="13" height="5" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.3" />
                <circle cx="4.2" cy="4" r="0.9" fill="currentColor" />
                <circle cx="4.2" cy="12" r="0.9" fill="currentColor" />
              </svg>
            </button>
            <button
              className={activeTab?.kind === 'skills' ? 'active' : ''}
              title={t('Skills')}
              onClick={() => toggleCenterTab('skills')}
            >
              <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M8 1.5l1.6 3.6 3.9.4-2.9 2.6.8 3.9L8 10.1l-3.4 1.9.8-3.9L2.5 5.5l3.9-.4z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
            <button
              className={`gitlog-toggle${gitLogOpen ? ' active' : ''}`}
              title={t('Git Log')}
              onClick={toggleGitLog}
            >
              <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="5" cy="3.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
                <circle cx="11.5" cy="12.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
                <path d="M5 5.5v3.5a3.5 3.5 0 0 0 3.5 3.5h1" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <line x1="5" y1="9" x2="5" y2="14.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>
            <button className={`term-toggle${termOpen ? ' active' : ''}`} title={t('Terminal')} onClick={toggleTerm}>
              <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
                <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
                <path
                  d="M4 6l3 2.5L4 11"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <line x1="8.5" y1="11" x2="12" y2="11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
