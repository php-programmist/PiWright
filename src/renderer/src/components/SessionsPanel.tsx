import { useMemo, useState } from 'react'
import { useChatStore } from '../stores/chat'
import { HISTORY_PREVIEW_LIMIT, projectKey, useSessionsStore } from '../stores/sessions'
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
    useSessionsStore.getState().setActive(result.hostId)
  }
  return (
    <div className="history-item" title={summary.title} onClick={() => void openSession()}>
      {children.length > 0 && (
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
  const refreshHistory = useSessionsStore((s) => s.refreshHistory)
  const setShowAll = useSessionsStore((s) => s.setShowAll)
  const t = useT()
  const [renaming, setRenaming] = useState(false)
  const [renameText, setRenameText] = useState('')
  const [subOpen, setSubOpen] = useState<Record<string, boolean>>({})
  const [wtCreating, setWtCreating] = useState(false)
  const [wtName, setWtName] = useState('')
  const openTranscript = useSessionsStore((s) => s.openTranscript)

  const newSession = async (): Promise<void> => {
    const ref = await window.piwright.newSession(row.project)
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

  const renameSession = async (hostId: string): Promise<void> => {
    if (renameText.trim().length > 0) await window.piwright.renameSession(hostId, renameText.trim())
    setRenaming(false)
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

  return (
    <div className="project">
      <div className="project-row">
        <button className="expand" onClick={() => toggleExpanded(key)}>{expanded ? '▾' : '▸'}</button>
        <span className="project-name" title={row.project.dir}>{dirName(row.project.dir)}</span>
        <span className="kind-badge">{kindLabel(row.project.kind)}</span>
        <span className="spacer" />
        <button className="icon" title={t('Session history')} onClick={() => { if (!expanded) toggleExpanded(key); void refreshHistory(row.project) }}>⟲</button>
        <button className="icon" title={t('New worktree')} onClick={() => setWtCreating(true)}>⎇</button>
        <button className="icon" title={t('New session')} onClick={() => void newSession()}>+</button>
        <button className="icon remove" title={t('Remove project')} onClick={() => void removeProject(row.project)}>×</button>
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
                  onClick={() => useSessionsStore.getState().setActive(s.hostId)}
                >
                  <SessionDot hostId={s.hostId} dot={s.dot} />
                  {sub.length > 0 && (
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
                  )}
                  {renaming ? (
                    <input
                      autoFocus
                      value={renameText}
                      onChange={(e) => setRenameText(e.target.value)}
                      onBlur={() => void renameSession(s.hostId)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void renameSession(s.hostId)
                        if (e.key === 'Escape') setRenaming(false)
                      }}
                    />
                  ) : (
                    <span className="session-title" onDoubleClick={() => setRenaming(true)}>{s.title}</span>
                  )}
                  {wt !== null && <span className="kind-badge" title={s.project.dir}>{wt.name}</span>}
                  <span className="spacer" />
                  <button className="icon" title={t('Rename (or double-click title)')} onClick={() => setRenaming(true)}>✎</button>
                  <button className="icon remove" title={t('Close session')} onClick={() => void closeSession(s.hostId)}>×</button>
                </div>
                {sub.length > 0 && subOpen[s.sessionFile!] &&
                  sub.map((c) => <TranscriptItem key={c.path} summary={c} onOpen={(x) => openTranscript(row.project, x)} />)}
              </div>
            )
          })}
          {active.length === 0 && <div className="panel-hint">{t('no active sessions')}</div>}
          <div className="history-head">{t('history')}</div>
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
                (childrenOf.get(h.path) ?? []).map((c) => <TranscriptItem key={c.path} summary={c} onOpen={(x) => openTranscript(row.project, x)} />)}
            </div>
          ))}
          {!row.historyLoading && topLevel.length > HISTORY_PREVIEW_LIMIT && (
            <button className="show-all" onClick={() => setShowAll(key, !row.showAllHistory)}>
              {row.showAllHistory ? t('show less') : t('show all ({count})', { count: topLevel.length })}
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
      </div>
    </aside>
  )
}
