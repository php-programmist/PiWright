import { useMemo, useState } from 'react'
import { useChatStore } from '../stores/chat'
import { HISTORY_PREVIEW_LIMIT, projectKey, useSessionsStore } from '../stores/sessions'
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

function HistoryItem({ project, summary }: { project: ProjectEntry; summary: SessionSummary }): React.JSX.Element {
  const openSession = async (): Promise<void> => {
    const ref = await window.piwright.openSession(project, summary.path)
    useSessionsStore.getState().setActive(ref.hostId)
  }
  return (
    <div className="history-item" title={summary.title} onClick={() => void openSession()}>
      <span className="history-title">{summary.title}</span>
      <span className="history-date">
        {new Date(summary.lastActivityEpochMs).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  )
}

function ProjectRow({ row }: { row: import('../stores/sessions').ProjectRow }): React.JSX.Element {
  const key = projectKey(row.project)
  const expanded = useSessionsStore((s) => s.expanded[key] ?? false)
  const activeHostId = useSessionsStore((s) => s.activeHostId)
  const activeAll = useSessionsStore((s) => s.active)
  const active = useMemo(() => activeAll.filter((r) => projectKey(r.project) === key), [activeAll, key])
  const toggleExpanded = useSessionsStore((s) => s.toggleExpanded)
  const removeProject = useSessionsStore((s) => s.removeProject)
  const refreshHistory = useSessionsStore((s) => s.refreshHistory)
  const setShowAll = useSessionsStore((s) => s.setShowAll)
  const [renaming, setRenaming] = useState(false)
  const [renameText, setRenameText] = useState('')

  const newSession = async (): Promise<void> => {
    const ref = await window.piwright.newSession(row.project)
    useSessionsStore.getState().setActive(ref.hostId)
    if (!expanded) toggleExpanded(key)
  }

  const closeSession = async (hostId: string): Promise<void> => {
    await window.piwright.closeSession(hostId)
    useChatStore.getState().removeHost(hostId)
    useSessionsStore.getState().forgetHost(hostId)
  }

  const renameSession = async (hostId: string): Promise<void> => {
    if (renameText.trim().length > 0) await window.piwright.renameSession(hostId, renameText.trim())
    setRenaming(false)
    setRenameText('')
  }

  const visible = row.showAllHistory ? row.history : row.history.slice(0, HISTORY_PREVIEW_LIMIT)

  return (
    <div className="project">
      <div className="project-row">
        <button className="expand" onClick={() => toggleExpanded(key)}>{expanded ? '▾' : '▸'}</button>
        <span className="project-name" title={row.project.dir}>{dirName(row.project.dir)}</span>
        <span className="kind-badge">{kindLabel(row.project.kind)}</span>
        <span className="spacer" />
        <button className="icon" title="Session history" onClick={() => { if (!expanded) toggleExpanded(key); void refreshHistory(row.project) }}>⟲</button>
        <button className="icon" title="New session" onClick={() => void newSession()}>+</button>
        <button className="icon remove" title="Remove project" onClick={() => void removeProject(row.project)}>×</button>
      </div>
      {expanded && (
        <div className="project-children">
          {active.map((s) => (
            <div
              key={s.hostId}
              className={`session-row${s.hostId === activeHostId ? ' current' : ''}`}
              onClick={() => useSessionsStore.getState().setActive(s.hostId)}
            >
              <span className={`dot ${DOT_CLASS[s.dot] ?? 'idle'}`} />
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
              <span className="spacer" />
              <button className="icon" title="Rename (or double-click title)" onClick={() => setRenaming(true)}>✎</button>
              <button className="icon remove" title="Close session" onClick={() => void closeSession(s.hostId)}>×</button>
            </div>
          ))}
          {active.length === 0 && <div className="panel-hint">no active sessions</div>}
          <div className="history-head">history</div>
          {row.historyLoading && <div className="panel-hint">loading…</div>}
          {!row.historyLoading && row.history.length === 0 && <div className="panel-hint">no past sessions</div>}
          {visible.map((h) => <HistoryItem key={h.path} project={row.project} summary={h} />)}
          {!row.historyLoading && row.history.length > HISTORY_PREVIEW_LIMIT && (
            <button className="show-all" onClick={() => setShowAll(key, !row.showAllHistory)}>
              {row.showAllHistory ? 'show less' : `show all (${row.history.length})`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function SessionsPanel(): React.JSX.Element {
  const projects = useSessionsStore((s) => s.projects)
  const [adding, setAdding] = useState(false)

  return (
    <aside className="sessions-panel">
      <div className="panel-head">
        <span>Projects</span>
        <span className="spacer" />
        {adding ? <AddProjectControl onDone={() => setAdding(false)} /> : <button className="icon" title="Add project" onClick={() => setAdding(true)}>+</button>}
      </div>
      <div className="panel-body">
        {projects.length === 0 && <div className="panel-hint">Add a project to start</div>}
        {projects.map((row) => <ProjectRow key={projectKey(row.project)} row={row} />)}
      </div>
    </aside>
  )
}
