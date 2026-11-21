import { useEffect, useMemo, useRef, useState } from 'react'
import { useChatStore } from '../stores/chat'
import { HISTORY_PREVIEW_LIMIT, projectKey, useSessionsStore } from '../stores/sessions'
import { parentTabKey, useTabsStore } from '../stores/tabs'
import { useLang, useT } from '../lib/i18n'
import { sameProjectDir, splitWorktreeHostDir } from '../../../shared/worktree'
import type { BackendMode, ProjectEntry, SessionSummary } from '../../../shared/ipc-contracts'

const DOT_CLASS: Record<string, string> = {
  confirm: 'confirm',
  question: 'question',
  busy: 'busy',
  idle: 'idle'
}

function dirName(dir: string): string {
  const parts = dir.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || dir
}

function kindLabel(kind: BackendMode): string {
  return kind === 'wsl' ? 'WSL' : 'Win'
}

function AddProjectControl({ onDone }: { onDone: () => void }): React.JSX.Element {
  const addProject = useSessionsStore((s) => s.addProject)
  const [busy, setBusy] = useState(false)

  const pick = async (kind: BackendMode): Promise<void> => {
    setBusy(true)
    const result = await window.piwright.chooseProjectDir(kind)
    setBusy(false)
    onDone()
    if (result.ok && result.dir !== null) await addProject({ kind, dir: result.dir })
  }

  return (
    <span className="add-project">
      <button disabled={busy} onClick={() => void pick('native')}>Win</button>
      <button disabled={busy} onClick={() => void pick('wsl')}>WSL</button>
      <button className="cancel" onClick={onDone}>×</button>
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

const WORKTREE_ICON = (
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

function ProjectRow({ row }: { row: import('../stores/sessions').ProjectRow }): React.JSX.Element {
  const key = projectKey(row.project)
  const expanded = useSessionsStore((s) => s.expanded[key] ?? false)
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
  const t = useT()
  const [renamingHostId, setRenamingHostId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
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
    await window.piwright.closeSession(hostId)
    useChatStore.getState().removeHost(hostId)
    useSessionsStore.getState().forgetHost(hostId)
    void refreshHistory(row.project)
  }

  const deleteHistory = async (summary: SessionSummary): Promise<void> => {
    const answer = window.confirm(
      t('Delete session "{title}" from disk?\n\nIts session file will be removed permanently.', { title: summary.title })
    )
    if (!answer) return
    const result = await window.piwright.deleteHistorySession(row.project, summary.path)
    if (!result.ok && result.error !== null) window.alert(result.error)
    void refreshHistory(row.project)
  }

  const startSessionRename = (hostId: string, title: string): void => {
    setRenameText(title)
    setRenamingHostId(hostId)
  }

  const submitSessionRename = async (hostId: string): Promise<void> => {
    setRenamingHostId(null)
    const name = renameText.trim()
    setRenameText('')
    if (name.length === 0) return
    const result = await window.piwright.renameSession(hostId, name)
    if (!result.ok && result.error !== null) window.alert(result.error)
  }

  const cancelSessionRename = (): void => {
    setRenamingHostId(null)
    setRenameText('')
  }

  const toggleSub = (path: string): void => {
    setSubOpen((prev) => ({ ...prev, [path]: !prev[path] }))
    void refreshHistory(row.project)
  }

  const activeIds = useMemo(() => new Set(active.map((r) => r.sessionId).filter((id): id is string => id !== null)), [active])
  const topLevel = useMemo(() => row.history.filter((h) => h.parentSession === null && !activeIds.has(h.id)), [row.history, activeIds])
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
  const visible = row.showAllHistory ? topLevel : topLevel.slice(0, HISTORY_PREVIEW_LIMIT)

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
    const answer = window.confirm(
      t('Remove project "{name}" from the list?\n\nThe folder and its sessions stay on disk. You can add it back anytime.', {
        name: projectName
      })
    )
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

  return (
    <div className="project">
      <div className="project-row">
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
        <div className="project-badges">
          {unreadCount > 0 && <span className="proj-badge green" title={t('Unread turns')}>{unreadCount}</span>}
          {busyCount > 0 && <span className="proj-badge busy" title={t('Working')}>{busyCount}</span>}
          {attentionCount > 0 && <span className="proj-badge attention" title={t('Need your answer')}>{attentionCount}</span>}
        </div>
      )}
      {expanded && (
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
          {active.map((s) => {
            const wt = splitWorktreeHostDir(s.project.dir)
            const sub = s.sessionFile !== null ? (childrenOf.get(s.sessionFile) ?? []) : []
            return (
              <div key={s.hostId}>
                <div
                  className={`session-row${s.hostId === activeHostId ? ' current' : ''}`}
                  onClick={() => {
                    useTabsStore.getState().setActiveProject(parentTabKey(s.project))
                    useTabsStore.getState().activateSession(s.project)
                    useSessionsStore.getState().setActive(s.hostId)
                  }}
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
                  {renamingHostId === s.hostId ? (
                    <input
                      autoFocus
                      value={renameText}
                      onChange={(e) => setRenameText(e.target.value)}
                      onBlur={() => void submitSessionRename(s.hostId)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void submitSessionRename(s.hostId)
                        if (e.key === 'Escape') cancelSessionRename()
                      }}
                    />
                  ) : (
                    <span className="session-title" onDoubleClick={() => startSessionRename(s.hostId, s.title)}>{s.title}</span>
                  )}
                  {wt !== null && <span className="kind-badge" title={s.project.dir}>{wt.name}</span>}
                  <span className="spacer" />
                  <button className="icon" title={t('Rename (or double-click title)')} onClick={() => startSessionRename(s.hostId, s.title)}>✎</button>
                  <button className="icon remove" title={t('Close session')} onClick={() => void closeSession(s.hostId)}>×</button>
                </div>
                {sub.length > 0 && subOpen[s.sessionFile!] &&
                  sub.map((c) => <TranscriptItem key={c.path} summary={c} onOpen={openTranscript} />)}
              </div>
            )
          })}
          {active.length === 0 && <div className="panel-hint">{t('no active sessions')}</div>}
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
                (childrenOf.get(h.path) ?? []).map((c) => <TranscriptItem key={c.path} summary={c} onOpen={openTranscript} />)}
            </div>
          ))}
          {!row.historyLoading && topLevel.length > HISTORY_PREVIEW_LIMIT && (
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
  const t = useT()
  const [adding, setAdding] = useState(false)
  const [version, setVersion] = useState('')

  useEffect(() => {
    void window.piwright.appVersion().then(setVersion)
  }, [])

  return (
    <aside className="sessions-panel">
      <div className="panel-head">
        <span>{t('Projects')}</span>
        <span className="spacer" />
        {adding ? <AddProjectControl onDone={() => setAdding(false)} /> : <button className="icon" title={t('Add project')} onClick={() => setAdding(true)}>+</button>}
      </div>
      <div className="panel-body">
        {projects.length === 0 && <div className="panel-hint">{t('Add a project to start')}</div>}
        {projects.map((row) => <ProjectRow key={projectKey(row.project)} row={row} />)}
      </div>
      <div className="panel-foot">
        <button className="icon" title={t('Settings')} onClick={openSettings}>⚙</button>
        {version.length > 0 && <span className="app-version" title={t('Version')}>v{version}</span>}
      </div>
    </aside>
  )
}
