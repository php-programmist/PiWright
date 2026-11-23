/** Таб-бар workspace: вкладки активного проекта. Обычные сессии, кнопка «новая сессия»,
 *  затем worktree-сессии и кнопка «новый worktree», затем файлы/диффы/MCP/навыки/транскрипты.
 *  Контекстное меню: закрыть, закрыть другие, закрыть все: <тип>, слева/справа; для сессий
 *  сверху «Переименовать». */
import { useEffect, useRef, useState } from 'react'
import { useSessionsStore } from '../stores/sessions'
import { useChatStore } from '../stores/chat'
import { parentTabKey, tabId, useCenterProject, useTabsStore, type ProjectTab, type TabKind } from '../stores/tabs'
import { useFilesStore } from '../stores/files'
import { useGitStore } from '../stores/git'
import { useT } from '../lib/i18n'
import { closeSessionAndSweepWorktree } from '../lib/worktree-cleanup'
import { splitWorktreeHostDir } from '../../../shared/worktree'
import { WORKTREE_ICON } from './SessionsPanel'
import { renameDialog } from './RenameDialog'
import { baseName } from '../views/git/GitPanel'

const DOT_CLASS: Record<string, string> = { confirm: 'confirm', question: 'question', busy: 'busy', waiting: 'waiting', idle: 'idle' }

interface MenuState {
  x: number
  y: number
  /** id вкладки: hostId для сессии, tabId для остальных. */
  id: string
  isSession: boolean
  kind: TabKind | 'session'
}

type T = (key: string, params?: Record<string, string | number>) => string

const NEW_SESSION_ICON = (
  <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6a1.5 1.5 0 0 1-1.5 1.5H8.4L5 13.6V11H3.5A1.5 1.5 0 0 1 2 9.5v-6Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    />
    <path d="M8 4.8v3.4M6.3 6.5h3.4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
)

const TAB_ICONS: Record<TabKind, React.JSX.Element> = {
  file: (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 1.5h6L13 5v9.5h-9.5Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M9.5 1.5V5H13" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  ),
  diff: (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 2.5h12v11H2Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8 2.5v11" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3.8 8h2.4M10.8 6.8v2.4M9.6 8h2.4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
  kanban: (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3.5 2.5v9M8 2.5v5.5M12.5 2.5v11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  ),
  mcp: (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 2h11v4.5h-11ZM2.5 9.5h11V14h-11Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <circle cx="4.7" cy="4.25" r="0.9" fill="currentColor" />
      <circle cx="4.7" cy="11.75" r="0.9" fill="currentColor" />
    </svg>
  ),
  skills: (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M8 1.8l1.6 4.6L14.2 8l-4.6 1.6L8 14.2 6.4 9.6 1.8 8l4.6-1.6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  ),
  transcript: (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6a1.5 1.5 0 0 1-1.5 1.5H8.4L5 13.6V11H3.5A1.5 1.5 0 0 1 2 9.5v-6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M5 5.5h6M5 8h4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
}

function tabLabel(tab: ProjectTab, t: T): string {
  if (tab.kind === 'file' || tab.kind === 'diff') return baseName(tab.path ?? '')
  if (tab.kind === 'transcript') return tab.title ?? baseName(tab.path ?? '')
  if (tab.kind === 'kanban') return tab.title ?? t('Kanban')
  return tab.kind === 'mcp' ? t('MCP servers') : t('Skills')
}

function typeLabel(kind: MenuState['kind'], t: T): string {
  switch (kind) {
    case 'session': return t('Sessions')
    case 'file': return t('Files')
    case 'diff': return t('Diffs')
    case 'mcp': return t('MCP servers')
    case 'skills': return t('Skills')
    case 'kanban': return t('Kanban')
    case 'transcript': return t('Transcripts')
  }
}

export function TabBar(): React.JSX.Element | null {
  const t = useT()
  const activeProjectKey = useTabsStore((s) => s.activeProjectKey)
  const activeHostId = useSessionsStore((s) => s.activeHostId)
  const activeAll = useSessionsStore((s) => s.active)
  const chatHosts = useChatStore((s) => s.hosts)
  const entry = useTabsStore((s) => (s.activeProjectKey !== null ? s.byProject[s.activeProjectKey] : undefined))
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [wtCreating, setWtCreating] = useState(false)
  const [wtName, setWtName] = useState('')
  const menuRef = useRef<HTMLDivElement | null>(null)
  const centerProject = useCenterProject()

  const sessionRows = activeProjectKey !== null ? activeAll.filter((r) => parentTabKey(r.project) === activeProjectKey) : []
  const regularRows = sessionRows.filter((r) => splitWorktreeHostDir(r.project.dir) === null)
  const wtRows = sessionRows.filter((r) => splitWorktreeHostDir(r.project.dir) !== null)
  const sessionActive = sessionRows.some((r) => r.hostId === activeHostId) && (entry?.activeId ?? null) === null
  const activeTab = !sessionActive && entry !== undefined ? (entry.tabs.find((tab) => tabId(tab) === entry.activeId) ?? null) : null

  useEffect(() => {
    if (menu === null) return
    const onDown = (e: MouseEvent): void => {
      if (menuRef.current !== null && !menuRef.current.contains(e.target as Node)) setMenu(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenu(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  if (activeProjectKey === null) return null

  const closeSession = async (hostId: string, askCleanup = true): Promise<void> => {
    await closeSessionAndSweepWorktree(hostId, askCleanup)
  }

  const baseProject = centerProject === null
    ? null
    : (() => {
        const wt = splitWorktreeHostDir(centerProject.dir)
        return wt !== null ? { kind: centerProject.kind, dir: wt.root } : centerProject
      })()

  const newSession = async (): Promise<void> => {
    if (baseProject === null) return
    const ref = await window.piwright.newSession(baseProject)
    useTabsStore.getState().setActiveProject(parentTabKey(baseProject))
    useTabsStore.getState().activateSession(baseProject)
    useSessionsStore.getState().setActive(ref.hostId)
  }

  const createWorktree = async (): Promise<void> => {
    const name = wtName.trim()
    setWtCreating(false)
    setWtName('')
    if (name.length === 0 || baseProject === null) return
    const result = await window.piwright.worktreeCreate(baseProject, name)
    if (!result.ok || result.dir === null) {
      if (result.error !== null) window.alert(result.error)
      return
    }
    const project = { kind: baseProject.kind, dir: result.dir }
    const ref = await window.piwright.newSession(project)
    useTabsStore.getState().setActiveProject(parentTabKey(project))
    useTabsStore.getState().activateSession(project)
    useSessionsStore.getState().setActive(ref.hostId)
  }

  const startRename = async (hostId: string, title: string): Promise<void> => {
    setMenu(null)
    const name = await renameDialog({ title: t('Rename session'), initial: title })
    if (name === null) return
    const result = await window.piwright.renameSession(hostId, name)
    if (!result.ok && result.error !== null) window.alert(result.error)
  }

  const activateTab = (tab: ProjectTab): void => {
    useTabsStore.getState().setActive(tab.project, tabId(tab))
    if (tab.kind === 'file') void useFilesStore.getState().openFile(tab.project, tab.path ?? '')
    if (tab.kind === 'diff' && tab.hash === undefined) void useGitStore.getState().openFile(tab.project, tab.path ?? '')
  }

  const closeTabById = (tab: ProjectTab): void => {
    if (tab.kind === 'file') useFilesStore.getState().closeContent(tab.project, tab.path ?? '')
    if (tab.kind === 'diff' && tab.hash === undefined) {
      const git = useGitStore.getState()
      if (git.selectedPath === tab.path) git.closeFile()
    }
    useTabsStore.getState().closeTab(tab.project, tabId(tab))
  }

  // Порядок для «слева/справа»: обычные сессии, worktree-сессии, затем остальные вкладки.
  const orderedIds: string[] = [...regularRows, ...wtRows].map((r) => r.hostId).concat((entry?.tabs ?? []).map(tabId))
  const menuIndex = menu !== null ? orderedIds.indexOf(menu.id) : -1

  const menuAction = (action: 'close' | 'others' | 'type' | 'left' | 'right'): void => {
    if (menu === null) return
    setMenu(null)
    const closeOne = (id: string, askCleanup: boolean): void => {
      if (sessionRows.some((r) => r.hostId === id)) {
        void closeSession(id, askCleanup)
        return
      }
      const tab = entry?.tabs.find((x) => tabId(x) === id)
      if (tab !== undefined) closeTabById(tab)
    }
    if (action === 'close') {
      closeOne(menu.id, true)
      return
    }
    if (action === 'others') {
      for (const id of orderedIds) if (id !== menu.id) closeOne(id, false)
      if (sessionRows.some((r) => r.hostId === menu.id)) useSessionsStore.getState().setActive(menu.id)
      else if (activeTab !== null || entry !== undefined) {
        const tab = entry?.tabs.find((x) => tabId(x) === menu.id)
        if (tab !== undefined) useTabsStore.getState().setActive(tab.project, menu.id)
      }
      return
    }
    if (action === 'type') {
      for (const id of orderedIds) {
        if (menu.kind === 'session') {
          if (sessionRows.some((r) => r.hostId === id)) void closeSession(id, false)
        } else {
          const tab = entry?.tabs.find((x) => tabId(x) === id)
          if (tab !== undefined && tab.kind === menu.kind) closeTabById(tab)
        }
      }
      return
    }
    const range = action === 'left' ? orderedIds.slice(0, menuIndex) : orderedIds.slice(menuIndex + 1)
    for (const id of range) closeOne(id, false)
  }

  const renderSessionTab = (r: (typeof sessionRows)[number]): React.JSX.Element => {
        const unread = chatHosts[r.hostId]?.unread ?? false
        const cls = DOT_CLASS[r.dot] ?? 'idle'
        const off = r.dot === 'idle' && !unread
        return (
          <div
            key={r.hostId}
            className={`tab session${r.hostId === activeHostId && (entry?.activeId ?? null) === null ? ' active' : ''}`}
            title={r.title}
            onClick={() => {
              useTabsStore.getState().activateSession(r.project)
              useSessionsStore.getState().setActive(r.hostId)
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu({ x: e.clientX, y: e.clientY, id: r.hostId, isSession: true, kind: 'session' })
            }}
          >
            <span className={`dot ${cls}${off ? ' dot-off' : ''}`} />
            <span className="tab-name">{r.title}</span>
            <button
              className="icon tab-close"
              title={t('Close session')}
              onClick={(e) => {
                e.stopPropagation()
                void closeSession(r.hostId)
              }}
            >
              ×
            </button>
          </div>
        )
  }

  return (
    <div className="tab-bar">
      {regularRows.map(renderSessionTab)}
      <button className="icon tab-add" title={t('New session')} onClick={() => void newSession()}>
        {NEW_SESSION_ICON}
      </button>
      {wtRows.map(renderSessionTab)}
      {wtCreating ? (
        <input
          autoFocus
          className="tab-add-input"
          value={wtName}
          placeholder={t('worktree name')}
          onChange={(e) => setWtName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void createWorktree()
            if (e.key === 'Escape') {
              setWtCreating(false)
              setWtName('')
            }
          }}
        />
      ) : (
        <button className="icon tab-add" title={t('New worktree')} onClick={() => setWtCreating(true)}>
          {WORKTREE_ICON}
        </button>
      )}
      {(entry?.tabs ?? []).map((tab) => (
        <div
          key={tabId(tab)}
          className={`tab ${tab.kind}${activeTab !== null && tabId(tab) === tabId(activeTab) ? ' active' : ''}`}
          title={tab.path ?? tabLabel(tab, t)}
          onClick={() => activateTab(tab)}
          onContextMenu={(e) => {
            e.preventDefault()
            setMenu({ x: e.clientX, y: e.clientY, id: tabId(tab), isSession: false, kind: tab.kind })
          }}
        >
          <span className="tab-icon">{TAB_ICONS[tab.kind]}</span>
          <span className="tab-name">{tabLabel(tab, t)}</span>
          <button
            className="icon tab-close"
            title={t('Close tab')}
            onClick={(e) => {
              e.stopPropagation()
              closeTabById(tab)
            }}
          >
            ×
          </button>
        </div>
      ))}
      {menu !== null && (
        <div className="tab-menu" style={{ left: menu.x, top: menu.y }} ref={menuRef}>
          {menu.isSession && (
            <button
              className="tab-menu-item"
              onClick={() => void startRename(menu.id, sessionRows.find((r) => r.hostId === menu.id)?.title ?? '')}
            >
              {t('Rename')}
            </button>
          )}
          <button className="tab-menu-item" onClick={() => menuAction('close')}>{t('Close')}</button>
          <button className="tab-menu-item" onClick={() => menuAction('others')}>{t('Close others')}</button>
          <button className="tab-menu-item" onClick={() => menuAction('type')}>
            {t('Close all: {type}', { type: typeLabel(menu.kind, t) })}
          </button>
          <button className="tab-menu-item" onClick={() => menuAction('left')}>{t('Close all left')}</button>
          <button className="tab-menu-item" onClick={() => menuAction('right')}>{t('Close all right')}</button>
        </div>
      )}
    </div>
  )
}
