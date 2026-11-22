/** Таб-бар workspace: вкладки активного проекта. Сессии — всегда первые (производные от
 *  активных сессий), затем файлы/диффы/MCP/навыки/транскрипты. Контекстное меню: закрыть,
 *  закрыть другие, закрыть все: <тип>, слева/справа; для сессий сверху «Переименовать». */
import { useEffect, useRef, useState } from 'react'
import { useSessionsStore } from '../stores/sessions'
import { useChatStore } from '../stores/chat'
import { parentTabKey, tabId, useTabsStore, type ProjectTab, type TabKind } from '../stores/tabs'
import { useFilesStore } from '../stores/files'
import { useGitStore } from '../stores/git'
import { useT } from '../lib/i18n'
import { closeSessionAndSweepWorktree } from '../lib/worktree-cleanup'
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

function tabLabel(tab: ProjectTab, t: T): string {
  if (tab.kind === 'file' || tab.kind === 'diff') return baseName(tab.path ?? '')
  if (tab.kind === 'transcript') return tab.title ?? baseName(tab.path ?? '')
  return tab.kind === 'mcp' ? t('MCP servers') : t('Skills')
}

function typeLabel(kind: MenuState['kind'], t: T): string {
  switch (kind) {
    case 'session': return t('Sessions')
    case 'file': return t('Files')
    case 'diff': return t('Diffs')
    case 'mcp': return t('MCP servers')
    case 'skills': return t('Skills')
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
  const [renamingHostId, setRenamingHostId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const menuRef = useRef<HTMLDivElement | null>(null)

  const sessionRows = activeProjectKey !== null ? activeAll.filter((r) => parentTabKey(r.project) === activeProjectKey) : []
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

  const startRename = (hostId: string, title: string): void => {
    setRenameText(title)
    setRenamingHostId(hostId)
    setMenu(null)
  }

  const submitRename = async (hostId: string): Promise<void> => {
    setRenamingHostId(null)
    const name = renameText.trim()
    setRenameText('')
    if (name.length === 0) return
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

  // Порядок для «слева/справа»: сессии, затем остальные вкладки.
  const orderedIds: string[] = [...sessionRows.map((r) => r.hostId), ...(entry?.tabs ?? []).map(tabId)]
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

  return (
    <div className="tab-bar">
      {sessionRows.map((r) => {
        const unread = chatHosts[r.hostId]?.unread ?? false
        const cls = DOT_CLASS[r.dot] ?? 'idle'
        const off = r.dot === 'idle' && !unread
        if (renamingHostId === r.hostId) {
          return (
            <div key={r.hostId} className="tab session active renaming">
              <input
                autoFocus
                value={renameText}
                onChange={(e) => setRenameText(e.target.value)}
                onBlur={() => void submitRename(r.hostId)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitRename(r.hostId)
                  if (e.key === 'Escape') setRenamingHostId(null)
                }}
              />
            </div>
          )
        }
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
      })}
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
              onClick={() => startRename(menu.id, sessionRows.find((r) => r.hostId === menu.id)?.title ?? '')}
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
