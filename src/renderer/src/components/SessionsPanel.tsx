import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useChatStore } from '../stores/chat'
import { HISTORY_PREVIEW_LIMIT, projectKey, useSessionsStore } from '../stores/sessions'
import { parentTabKey, useTabsStore } from '../stores/tabs'
import { useLang, useT } from '../lib/i18n'
import { isWindows } from '../lib/platform'
import { canReveal, isWeb } from '../api/web'
import { closeSessionAndSweepWorktree, makeSessionBackground, stopSession } from '../lib/worktree-cleanup'
import { persistPanel } from '../stores/panels-prefs'
import { confirmDialog } from './ConfirmDialog'
import { ChangelogModal } from './ChangelogModal'
import { SshProjectDialog } from './SshProjectDialog'
import { LocalDirDialog } from './LocalDirDialog'
import { renameDialog } from './RenameDialog'
import { sameProjectDir, splitWorktreeHostDir } from '../../../shared/worktree'
import type { BackendMode, DaemonBgSession, DaemonStatus, ProjectEntry, SessionSummary, UpdateStatus } from '../../../shared/ipc-contracts'

const DOT_CLASS: Record<string, string> = {
  confirm: 'confirm',
  question: 'question',
  busy: 'busy',
  waiting: 'waiting',
  idle: 'idle',
  error: 'error'
}

function dirName(dir: string): string {
  const parts = dir.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || dir
}

function kindLabel(kind: BackendMode): string {
  return kind === 'wsl' ? 'WSL' : kind === 'ssh' ? 'SSH' : isWindows ? 'Win' : 'Local'
}

function AddProjectControl({ onDone }: { onDone: () => void }): React.JSX.Element {
  const addProject = useSessionsStore((s) => s.addProject)
  const settings = useSessionsStore((s) => s.settings)
  const [busy, setBusy] = useState(false)
  const [sshOpen, setSshOpen] = useState(false)
  const [localOpen, setLocalOpen] = useState(false)

  const pick = async (kind: BackendMode): Promise<void> => {
    // Веб-режим: нативного диалога нет — папка на сервере выбирается обзором по RPC.
    if (isWeb) {
      setLocalOpen(true)
      return
    }
    setBusy(true)
    const result = await window.piwright.chooseProjectDir(kind)
    setBusy(false)
    onDone()
    if (result.ok && result.dir !== null) await addProject({ kind, dir: result.dir })
  }

  const servers = settings?.sshServers ?? []

  return (
    <span className="add-project">
      <button disabled={busy} onClick={() => void pick('native')}>{isWindows ? 'Win' : 'Local'}</button>
      {isWindows && !isWeb && <button disabled={busy} onClick={() => void pick('wsl')}>WSL</button>}
      <button disabled={busy} onClick={() => setSshOpen(true)}>SSH</button>
      <button className="cancel" onClick={onDone}>×</button>
      {sshOpen && (
        <SshProjectDialog
          servers={servers}
          onDone={onDone}
          onClose={() => setSshOpen(false)}
        />
      )}
      {localOpen && <LocalDirDialog kind="native" onDone={onDone} onClose={() => setLocalOpen(false)} />}
    </span>
  )
}

function HistoryItem({
  project,
  summary,
  children,
  subOpen,
  onToggleSub,
  onDelete
}: {
  project: ProjectEntry
  summary: SessionSummary
  children: SessionSummary[]
  subOpen: boolean
  onToggleSub: () => void
  onDelete: () => void
}): React.JSX.Element {
  const t = useT()
  const lang = useLang()
  const openSession = async (): Promise<void> => {
    const result = await window.piwright.openSession(project, summary.path)
    if (!result.ok) {
      if (result.error !== null) window.alert(result.error)
      return
    }
    useTabsStore.getState().setActiveProject(parentTabKey(project))
    useTabsStore.getState().activateSession(project)
    useSessionsStore.getState().setActive(result.hostId)
  }
  return (
    <div className="history-item" title={summary.title} onClick={() => void openSession()}>
      {children.length > 0 ? (
        <button
          className="icon sub-toggle"
          title={t('Subagent sessions')}
          onClick={(e) => {
            e.stopPropagation()
            onToggleSub()
          }}
        >
          {subOpen ? '▾' : '▸'}
        </button>
      ) : (
        <span className="sub-toggle" />
      )}
      <span className="history-title">{summary.title}</span>
      <span className="history-date">
        {new Date(summary.lastActivityEpochMs).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })}
      </span>
      <button
        className="icon remove"
        title={t('Delete session from disk')}
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
      >
        ×
      </button>
    </div>
  )
}

function TranscriptItem({ summary, onOpen }: { summary: SessionSummary; onOpen: (summary: SessionSummary) => void }): React.JSX.Element {
  const lang = useLang()
  return (
    <div className="history-item sub" title={summary.title} onClick={() => onOpen(summary)}>
      <span className="history-title">{summary.title}</span>
      <span className="history-date">
        {new Date(summary.lastActivityEpochMs).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })}
      </span>
    </div>
  )
}

function SessionDot({ hostId, dot }: { hostId: string; dot: import('../../../shared/ipc-contracts').SessionDot }): React.JSX.Element {
  const unread = useChatStore((s) => s.hosts[hostId]?.unread ?? false)
  const cls = DOT_CLASS[dot] ?? 'idle'
  const off = dot === 'idle' && !unread
  return <span className={`dot ${cls}${off ? ' dot-off' : ''}`} />
}

export const WORKTREE_ICON = (
  <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="4.5" cy="3.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="11.5" cy="4.5" r="2" fill="none" stroke="currentColor" strokeWidth="1.3" />
    <path
      d="M4.5 5.5v9M11.5 6.5v.9c0 1.6-1.2 2.6-2.8 2.6H4.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    />
  </svg>
)

function ProjectRow({
  row,
  query,
  index,
  dragging,
  canDrag,
  onDragStart,
  onDragEnd
}: {
  row: import('../stores/sessions').ProjectRow
  query: string
  index: number
  dragging: boolean
  canDrag: boolean
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
}): React.JSX.Element {
  const key = projectKey(row.project)
  const expanded = useSessionsStore((s) => s.expanded[key] ?? false)
  const isActiveProject = useTabsStore((s) => s.activeProjectKey === key)
  const activeHostId = useSessionsStore((s) => s.activeHostId)
  const activeAll = useSessionsStore((s) => s.active)
  const active = useMemo(
    () =>
      activeAll.filter((r) => {
        if (projectKey(r.project) === key) return true
        const wt = splitWorktreeHostDir(r.project.dir)
        return wt !== null && sameProjectDir(wt.root, row.project.dir)
      }),
    [activeAll, key, row.project.dir]
  )
  const unreadCount = useChatStore((s) =>
    active.reduce((n, r) => (r.dot === 'idle' && (s.hosts[r.hostId]?.unread ?? false) ? n + 1 : n), 0)
  )
  const busyCount = useMemo(() => active.filter((r) => r.dot === 'busy').length, [active])
  const attentionCount = useMemo(() => active.filter((r) => r.dot === 'confirm' || r.dot === 'question').length, [active])
  const toggleExpanded = useSessionsStore((s) => s.toggleExpanded)
  const removeProject = useSessionsStore((s) => s.removeProject)
  const renameProject = useSessionsStore((s) => s.renameProject)
  const refreshHistory = useSessionsStore((s) => s.refreshHistory)
  const setShowAll = useSessionsStore((s) => s.setShowAll)
  const backgroundSessions = useSessionsStore((s) => s.settings?.backgroundSessions ?? false)
  const t = useT()
  const [menuOpen, setMenuOpen] = useState(false)
  const [projRenaming, setProjRenaming] = useState(false)
  const [projRenameText, setProjRenameText] = useState('')
  const menuRef = useRef<HTMLSpanElement | null>(null)
  const [subOpen, setSubOpen] = useState<Record<string, boolean>>({})
  const [wtCreating, setWtCreating] = useState(false)
  const [wtName, setWtName] = useState('')

  const openTranscript = (summary: SessionSummary): void => {
    useTabsStore.getState().openTranscript(row.project, summary)
  }

  const newSession = async (): Promise<void> => {
    const ref = await window.piwright.newSession(row.project)
    useTabsStore.getState().setActiveProject(parentTabKey(row.project))
    useTabsStore.getState().activateSession(row.project)
    useSessionsStore.getState().setActive(ref.hostId)
    if (!expanded) toggleExpanded(key)
  }

  const createWorktree = async (): Promise<void> => {
    const name = wtName.trim()
    setWtCreating(false)
    setWtName('')
    if (name.length === 0) return
    const result = await window.piwright.worktreeCreate(row.project, name)
    if (!result.ok || result.dir === null) {
      if (result.error !== null) window.alert(result.error)
      return
    }
    const ref = await window.piwright.newSession({ kind: row.project.kind, dir: result.dir })
    useTabsStore.getState().setActiveProject(parentTabKey({ kind: row.project.kind, dir: result.dir }))
    useTabsStore.getState().activateSession({ kind: row.project.kind, dir: result.dir })
    useSessionsStore.getState().setActive(ref.hostId)
    if (!expanded) toggleExpanded(key)
  }

  const closeSession = async (hostId: string): Promise<void> => {
    await closeSessionAndSweepWorktree(hostId)
  }

  const deleteHistory = async (summary: SessionSummary): Promise<void> => {
    const answer = await confirmDialog({
      message: t('Delete session "{title}" from disk?\n\nIts session file will be removed permanently.', { title: summary.title }),
      confirmLabel: t('Delete'),
      danger: true
    })
    if (!answer) return
    const result = await window.piwright.deleteHistorySession(row.project, summary.path)
    if (!result.ok && result.error !== null) window.alert(result.error)
    void refreshHistory(row.project)
  }

  const startSessionRename = async (hostId: string, title: string): Promise<void> => {
    const name = await renameDialog({ title: t('Rename session'), initial: title })
    if (name === null) return
    const result = await window.piwright.renameSession(hostId, name)
    if (!result.ok && result.error !== null) window.alert(result.error)
  }

  const toggleSub = (path: string): void => {
    setSubOpen((prev) => ({ ...prev, [path]: !prev[path] }))
    void refreshHistory(row.project)
  }

  const activeIds = useMemo(() => new Set(active.map((r) => r.sessionId).filter((id): id is string => id !== null)), [active])

  /** Открыть вкладку сессии (клик по строке и play-иконка фоновой сессии — одно и то же). */
  const openSessionRow = (s: (typeof active)[number]): void => {
    useTabsStore.getState().setActiveProject(parentTabKey(s.project))
    useTabsStore.getState().activateSession(s.project)
    useSessionsStore.getState().setActive(s.hostId)
  }

  const q = query.trim().toLowerCase()
  const matches = (title: string): boolean => q === '' || title.toLowerCase().includes(q)
  const activeFiltered = q === '' ? active : active.filter((r) => r.title.toLowerCase().includes(q))
  const topLevel = row.history.filter(
    (h) => h.parentSession === null && !activeIds.has(h.id) && (q === '' || h.title.toLowerCase().includes(q))
  )
  const childrenOf = useMemo(() => {
    const map = new Map<string, SessionSummary[]>()
    for (const h of row.history) {
      if (h.parentSession === null) continue
      const list = map.get(h.parentSession)
      if (list !== undefined) list.push(h)
      else map.set(h.parentSession, [h])
    }
    return map
  }, [row.history])
  const visible = q !== '' || row.showAllHistory ? topLevel : topLevel.slice(0, HISTORY_PREVIEW_LIMIT)

  const projectName = row.project.name ?? dirName(row.project.dir)

  const startProjRename = (): void => {
    setProjRenameText(projectName)
    setProjRenaming(true)
  }

  const submitProjRename = async (): Promise<void> => {
    setProjRenaming(false)
    await renameProject(row.project, projRenameText)
  }

  const removeProjectWithConfirm = async (): Promise<void> => {
    const answer = await confirmDialog({
      message: t('Remove project "{name}" from the list?\n\nThe folder and its sessions stay on disk. You can add it back anytime.', {
        name: projectName
      }),
      confirmLabel: t('Remove project'),
      danger: true
    })
    if (!answer) return
    useTabsStore.getState().forgetProject(projectKey(row.project))
    await removeProject(row.project)
  }

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent): void => {
      if (menuRef.current !== null && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  if (q !== '' && activeFiltered.length === 0 && topLevel.length === 0) return <></>

  return (
    <div className={`project${isActiveProject ? ' active' : ''}${dragging ? ' dragging' : ''}`} data-project-index={index}>
      <div
        className="project-row"
        draggable={canDrag && !projRenaming}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <button className="expand" onClick={() => toggleExpanded(key)}>{expanded ? '▾' : '▸'}</button>
        {projRenaming ? (
          <input
            className="project-rename"
            autoFocus
            value={projRenameText}
            onChange={(e) => setProjRenameText(e.target.value)}
            onBlur={() => void submitProjRename()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitProjRename()
              if (e.key === 'Escape') setProjRenaming(false)
            }}
          />
        ) : (
          <span className="project-name" title={row.project.dir} onClick={() => useTabsStore.getState().setActiveProject(key)}>{projectName}</span>
        )}
        <span className="kind-badge">{kindLabel(row.project.kind)}</span>
        <span className="spacer" />
        <button className="icon" title={t('New worktree')} onClick={() => setWtCreating(true)}>{WORKTREE_ICON}</button>
        <button className="icon" title={t('New session')} onClick={() => void newSession()}>+</button>
        <span className="menu-wrap" ref={menuRef}>
          <button className="icon" title={t('Project menu')} onClick={() => setMenuOpen((v) => !v)}>⋯</button>
          {menuOpen && (
            <div className="project-menu">
              <button
                className="project-menu-item"
                onClick={() => {
                  setMenuOpen(false)
                  startProjRename()
                }}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M11.2 2.3l2.5 2.5L5.5 13H3v-2.5z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                </svg>
                {t('Rename')}
              </button>
              {canReveal && (
              <button
                className="project-menu-item"
                onClick={() => {
                  setMenuOpen(false)
                  void window.piwright.revealProject(row.project)
                }}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M2 4.5c0-.6.4-1 1-1h3l1.5 1.5H13c.6 0 1 .4 1 1v6c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.3"
                  />
                </svg>
                {t('Show in folder')}
              </button>
              )}
              <div className="project-menu-sep" />
              <button
                className="project-menu-item danger"
                onClick={() => {
                  setMenuOpen(false)
                  void removeProjectWithConfirm()
                }}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M3 4.5h10M6.5 4.5V3h3v1.5M5 4.5l.6 8.5h4.8l.6-8.5M6.8 7v3.5M9.2 7v3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                  />
                </svg>
                {t('Remove project')}
              </button>
            </div>
          )}
        </span>
      </div>
      {!expanded && unreadCount + busyCount + attentionCount > 0 && (
        <div className="project-badges" onClick={() => toggleExpanded(key)}>
          {unreadCount > 0 && <span className="proj-badge green" title={t('Unread turns')}>{unreadCount}</span>}
          {busyCount > 0 && <span className="proj-badge busy" title={t('Working')}>{busyCount}</span>}
          {attentionCount > 0 && <span className="proj-badge attention" title={t('Need your answer')}>{attentionCount}</span>}
        </div>
      )}
      {(expanded || q !== '') && (
        <div className="project-children">
          {wtCreating && (
            <div className="session-row">
              <input
                autoFocus
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
                onBlur={() => {
                  setWtCreating(false)
                  setWtName('')
                }}
              />
            </div>
          )}
          {activeFiltered.map((s) => {
            const wt = splitWorktreeHostDir(s.project.dir)
            const sub = s.sessionFile !== null ? (childrenOf.get(s.sessionFile) ?? []) : []
            return (
              <div key={s.hostId}>
                <div
                  className={`session-row${s.hostId === activeHostId ? ' current' : ''}`}
                  onClick={() => openSessionRow(s)}
                >
                  <SessionDot hostId={s.hostId} dot={s.dot} />
                  {sub.length > 0 ? (
                    <button
                      className="icon sub-toggle"
                      title={t('Subagent sessions')}
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleSub(s.sessionFile!)
                      }}
                    >
                      {subOpen[s.sessionFile!] ? '▾' : '▸'}
                    </button>
                  ) : (
                    <span className="sub-toggle" />
                  )}
                  <span className="session-title" onDoubleClick={() => void startSessionRename(s.hostId, s.title)}>{s.title}</span>
                  {wt !== null && <span className="kind-badge" title={s.project.dir}>{wt.name}</span>}
                  <span className="spacer" />
                  {s.background && (
                    <button
                      className="icon play"
                      title={t('Attach session')}
                      onClick={(e) => {
                        e.stopPropagation()
                        openSessionRow(s)
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M7 4.5v15l13-7.5z" fill="currentColor" />
                      </svg>
                    </button>
                  )}
                  <button className="icon" title={t('Rename (or double-click title)')} onClick={() => void startSessionRename(s.hostId, s.title)}>✎</button>
                  {backgroundSessions && !s.background && s.dot !== 'idle' && (
                    <button
                      className="icon eject"
                      title={t('Make background')}
                      onClick={(e) => {
                        e.stopPropagation()
                        void makeSessionBackground(s.hostId)
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
                        <path d="M12 4.5l8 8.5H4z" fill="currentColor" />
                        <rect x="4" y="16.5" width="16" height="3" rx="1" fill="currentColor" />
                      </svg>
                    </button>
                  )}
                  {backgroundSessions && <button className="icon stop" title={t('Stop session')} onClick={() => void stopSession(s.hostId)}>■</button>}
                  {!backgroundSessions && <button className="icon remove" title={t('Close session')} onClick={() => void closeSession(s.hostId)}>×</button>}
                </div>
                {sub.length > 0 && subOpen[s.sessionFile!] &&
                  sub.filter((c) => matches(c.title)).map((c) => <TranscriptItem key={c.path} summary={c} onOpen={openTranscript} />)}
              </div>
            )
          })}
          {q === '' && active.length === 0 && <div className="panel-hint">{t('no active sessions')}</div>}
          <div className="history-head">{t('History')}</div>
          {row.historyLoading && <div className="panel-hint">{t('loading…')}</div>}
          {!row.historyLoading && topLevel.length === 0 && <div className="panel-hint">{t('no past sessions')}</div>}
          {visible.map((h) => (
            <div key={h.path}>
              <HistoryItem
                project={row.project}
                summary={h}
                children={childrenOf.get(h.path) ?? []}
                subOpen={subOpen[h.path] ?? false}
                onToggleSub={() => toggleSub(h.path)}
                onDelete={() => void deleteHistory(h)}
              />
              {subOpen[h.path] &&
                (childrenOf.get(h.path) ?? []).filter((c) => matches(c.title)).map((c) => <TranscriptItem key={c.path} summary={c} onOpen={openTranscript} />)}
            </div>
          ))}
          {q === '' && !row.historyLoading && topLevel.length > HISTORY_PREVIEW_LIMIT && (
            <button className="show-all" onClick={() => setShowAll(key, !row.showAllHistory)}>
              {row.showAllHistory ? t('Show less') : t('Show all ({count})', { count: topLevel.length })}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function SessionsPanel(): React.JSX.Element {
  const projects = useSessionsStore((s) => s.projects)
  const openSettings = useSessionsStore((s) => s.openSettings)
  const width = useSessionsStore((s) => s.sidebarWidth)
  const collapsed = useSessionsStore((s) => s.sidebarCollapsed)
  const setSidebarWidth = useSessionsStore((s) => s.setSidebarWidth)
  const setSidebarCollapsed = useSessionsStore((s) => s.setSidebarCollapsed)
  const activeAll = useSessionsStore((s) => s.active)
  const unreadCount = useChatStore((s) =>
    activeAll.reduce((n, r) => (r.dot === 'idle' && (s.hosts[r.hostId]?.unread ?? false) ? n + 1 : n), 0)
  )
  const busyCount = useMemo(() => activeAll.filter((r) => r.dot === 'busy').length, [activeAll])
  const attentionCount = useMemo(() => activeAll.filter((r) => r.dot === 'confirm' || r.dot === 'question').length, [activeAll])
  const t = useT()
  const [adding, setAdding] = useState(false)
  const [version, setVersion] = useState('')
  const [changelogOpen, setChangelogOpen] = useState(false)
  const [updateFrom, setUpdateFrom] = useState<string | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ availableVersion: null, phase: 'idle' })
  const [daemon, setDaemon] = useState<DaemonStatus>({ alive: false, background: 0, skew: null, sessions: [] })
  const [bgOpen, setBgOpen] = useState(false)
  const daemonBgRef = useRef<HTMLSpanElement>(null)
  const [query, setQuery] = useState('')
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const [dragKey, setDragKey] = useState<string | null>(null)
  const [dropIndex, setDropIndex] = useState<number | null>(null)
  const dragKeyRef = useRef<string | null>(null)
  const dropIndexRef = useRef<number | null>(null)

  const projectDragStart = (key: string) => (e: React.DragEvent): void => {
    e.dataTransfer.setData('text/plain', key)
    e.dataTransfer.effectAllowed = 'move'
    dragKeyRef.current = key
    setDragKey(key)
  }

  const projectDragEnd = (): void => {
    dragKeyRef.current = null
    dropIndexRef.current = null
    setDragKey(null)
    setDropIndex(null)
  }

  const bodyDragOver = (e: React.DragEvent): void => {
    if (dragKeyRef.current === null || bodyRef.current === null) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const els = Array.from(bodyRef.current.querySelectorAll<HTMLElement>('[data-project-index]'))
    let index = els.length
    for (let i = 0; i < els.length; i += 1) {
      const rect = els[i].getBoundingClientRect()
      if (e.clientY < rect.top + rect.height / 2) {
        index = Number(els[i].dataset.projectIndex)
        break
      }
    }
    dropIndexRef.current = index
    setDropIndex(index)
  }

  const bodyDragLeave = (e: React.DragEvent): void => {
    const body = e.currentTarget as HTMLElement
    if (e.relatedTarget instanceof Node && body.contains(e.relatedTarget)) return
    dropIndexRef.current = null
    setDropIndex(null)
  }

  const bodyDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    const key = dragKeyRef.current ?? e.dataTransfer.getData('text/plain')
    const index = dropIndexRef.current
    projectDragEnd()
    if (key.length === 0 || index === null) return
    useSessionsStore.getState().moveProject(key, index)
  }

  useEffect(() => {
    void window.piwright.appVersion().then(setVersion)
    void window.piwright.updateInfo().then((info) => {
      if (info.updatedFrom !== null) setUpdateFrom(info.updatedFrom)
    })
    void window.piwright.updateStatus().then(setUpdateStatus)
    return window.piwright.onUpdateEvent(setUpdateStatus)
  }, [])

  // Демон фоновых сессий: индикатор «N в фоне» — опрос раз в 5 с (канал pull, пушей нет).
  useEffect(() => {
    let cancelled = false
    const pull = (): void => {
      void window.piwright.daemonStatus().then((s) => {
        if (!cancelled) setDaemon(s)
      })
    }
    pull()
    const timer = setInterval(pull, 5000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const stopBackground = async (): Promise<void> => {
    if (!(await confirmDialog({ message: t('Stop background sessions? Running agents will be interrupted.'), confirmLabel: t('Stop'), danger: true }))) return
    await window.piwright.stopBackgroundSessions()
    void window.piwright.daemonStatus().then(setDaemon)
  }

  // Поповер фоновых сессий: клик вне и Escape закрывают (как у ContextBreakdownControl).
  useEffect(() => {
    if (!bgOpen) return
    const onDown = (e: MouseEvent): void => {
      if (daemonBgRef.current !== null && !daemonBgRef.current.contains(e.target as Node)) setBgOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setBgOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [bgOpen])

  /** Аттач фоновой сессии из попапа: открыть вкладку (ребёнок демона приатчится). */
  const attachBgSession = async (s: DaemonBgSession): Promise<void> => {
    if (s.sessionFile === null) return
    const project: ProjectEntry = { kind: s.mode, dir: s.projectDir }
    const result = await window.piwright.openSession(project, s.sessionFile)
    if (!result.ok) {
      if (result.error !== null) window.alert(result.error)
      return
    }
    setBgOpen(false)
    useTabsStore.getState().setActiveProject(parentTabKey(project))
    useTabsStore.getState().activateSession(project)
    useSessionsStore.getState().setActive(result.hostId)
    void window.piwright.daemonStatus().then(setDaemon)
  }

  const availableVersion = updateStatus.availableVersion
  const downloading = updateStatus.phase === 'downloading'

  const collapse = (): void => {
    setSidebarCollapsed(true)
    persistPanel('sessions', { open: false })
  }

  const expand = (): void => {
    setSidebarCollapsed(false)
    persistPanel('sessions', { open: true })
  }

  const startResize = (down: React.MouseEvent): void => {
    down.preventDefault()
    const move = (e: MouseEvent): void => setSidebarWidth(e.clientX)
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      persistPanel('sessions', { width: useSessionsStore.getState().sidebarWidth })
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  if (collapsed) {
    return (
      <aside className="sessions-panel collapsed">
        <button className="icon expand-sidebar" title={t('Expand panel')} onClick={expand}>
          <svg width="25" height="25" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M6 5l7 7-7 7M13 5l7 7-7 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <div className="sidebar-badges" onClick={expand}>
          {unreadCount > 0 && <span className="proj-badge green" title={t('Unread turns')}>{unreadCount}</span>}
          {busyCount > 0 && <span className="proj-badge busy" title={t('Working')}>{busyCount}</span>}
          {attentionCount > 0 && <span className="proj-badge attention" title={t('Need your answer')}>{attentionCount}</span>}
        </div>
        <button className="icon collapsed-settings" title={t('Settings')} onClick={openSettings}>⚙</button>
      </aside>
    )
  }

  return (
    <aside className="sessions-panel" style={{ width, minWidth: width }}>
      <div className="sessions-resizer" onMouseDown={startResize} />
      <div className="panel-head">
        <span>{t('Projects')}</span>
        <span className="spacer" />
        {adding ? <AddProjectControl onDone={() => setAdding(false)} /> : <button className="icon" title={t('Add project')} onClick={() => setAdding(true)}>+</button>}
        <button className="icon" title={t('Collapse panel')} onClick={collapse}>−</button>
      </div>
      <div className="panel-search">
        <input
          value={query}
          placeholder={t('Search sessions…')}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setQuery('')
          }}
        />
      </div>
      <div className="panel-body" ref={bodyRef} onDragOver={bodyDragOver} onDragLeave={bodyDragLeave} onDrop={bodyDrop}>
        {projects.length === 0 && <div className="panel-hint">{t('Add a project to start')}</div>}
        {projects.map((row, i) => {
          const key = projectKey(row.project)
          return (
            <Fragment key={key}>
              {dropIndex === i && <div className="project-drop-line" />}
              <ProjectRow
                row={row}
                query={query}
                index={i}
                dragging={dragKey === key}
                canDrag={query === ''}
                onDragStart={projectDragStart(key)}
                onDragEnd={projectDragEnd}
              />
            </Fragment>
          )
        })}
        {dropIndex === projects.length && <div className="project-drop-line" />}
      </div>
      <div className="panel-foot">
        <button className="icon" title={t('Settings')} onClick={openSettings}>⚙</button>
        {daemon.background > 0 && (
          <span className="daemon-bg" ref={daemonBgRef}>
            <button
              className="daemon-bg-count"
              title={t('Sessions running in the background (PiWright closed or tab closed)')}
              onClick={() => setBgOpen((v) => !v)}
            >
              {t('{count} in background', { count: daemon.background })}
            </button>
            <button className="icon daemon-bg-stop" title={t('Stop background sessions')} onClick={() => void stopBackground()}>■</button>
            {bgOpen && (
              <div className="daemon-bg-popover">
                <div className="daemon-bg-head">{t('Background sessions')}</div>
                {daemon.sessions.length === 0 && <div className="daemon-bg-empty">{t('No background sessions')}</div>}
                {daemon.sessions.map((s) => {
                  const label = s.title ?? (s.sessionFile !== null ? dirName(s.sessionFile).replace(/\.json$/, '') : '—')
                  return (
                    <button
                      key={s.sessionKey}
                      className="daemon-bg-row"
                      disabled={s.sessionFile === null}
                      title={s.sessionFile === null ? t('Session has no file yet') : t('Attach session')}
                      onClick={() => void attachBgSession(s)}
                    >
                      {s.streaming && <span className="daemon-bg-dot" title={t('Agent is running')} />}
                      <span className="daemon-bg-row-title">{label}</span>
                      <span className="daemon-bg-row-project">{dirName(s.projectDir)}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </span>
        )}
        {updateFrom !== null && version !== '' && !changelogOpen && (
          <div className="update-popup" onClick={() => {
            setUpdateFrom(null)
            setChangelogOpen(true)
          }}>
            <div className="update-popup-text">
              <b>{t('PiWright updated to {version}', { version })}</b>
              <span>{t('Click the version to see what changed')}</span>
            </div>
            <button
              className="update-popup-close"
              title={t('Close')}
              onClick={(e) => {
                e.stopPropagation()
                setUpdateFrom(null)
              }}
            >
              ×
            </button>
          </div>
        )}
        {availableVersion !== null && (
          <div className="update-offer">
            <span className="update-offer-text">
              {t('Update available to version {version}', { version: availableVersion })}
            </span>
            <div className="update-offer-buttons">
              <button
                className="update-offer-install"
                disabled={downloading}
                onClick={() => void window.piwright.downloadUpdate().then(setUpdateStatus)}
              >
                {downloading ? t('Downloading…') : t('Download and install')}
              </button>
              <button
                className="update-offer-dismiss"
                disabled={downloading}
                title={t('Hide until the next version is released')}
                onClick={() => void window.piwright.dismissUpdate().then(setUpdateStatus)}
              >
                {t("Don't suggest this version")}
              </button>
            </div>
          </div>
        )}
        {version.length > 0 && (
          <span
            className="app-version clickable"
            title={t('Changelog')}
            onClick={() => {
              setUpdateFrom(null)
              setChangelogOpen(true)
            }}
          >
            v{version}
          </span>
        )}
      </div>
      {changelogOpen && <ChangelogModal onClose={() => setChangelogOpen(false)} />}
    </aside>
  )
}
