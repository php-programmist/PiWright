import { useEffect, useMemo } from 'react'
import { useGitStore } from '../../stores/git'
import { useSessionsStore } from '../../stores/sessions'
import type { GitFileEntry } from '../../../../shared/ipc-contracts'

const BADGE_CLASS: Record<string, string> = {
  M: 'mod',
  A: 'add',
  D: 'del',
  R: 'ren',
  C: 'ren',
  T: 'mod',
  U: 'conflict',
  '?': 'unt'
}

export function baseName(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

function FileRow({
  entry,
  badge,
  action,
  onOpen,
  onToggle
}: {
  entry: GitFileEntry
  badge: string
  action: string
  onOpen: () => void
  onToggle: () => void
}): React.JSX.Element {
  return (
    <div className="git-file" onClick={onOpen}>
      <span className={`git-badge ${BADGE_CLASS[badge] ?? 'mod'}`}>{badge}</span>
      <span className="git-file-name" title={entry.origPath !== null ? `${entry.origPath} → ${entry.path}` : entry.path}>
        {baseName(entry.path)}
      </span>
      <button
        className="icon"
        title={action === '+' ? 'Stage' : 'Unstage'}
        onClick={(e) => {
          e.stopPropagation()
          onToggle()
        }}
      >
        {action}
      </button>
    </div>
  )
}

function ErrorBanner(): React.JSX.Element | null {
  const error = useGitStore((s) => s.error)
  const setError = useGitStore((s) => s.setError)
  if (error === null) return null
  return (
    <div className="git-error">
      <span>{error}</span>
      <button className="icon" onClick={() => setError(null)}>×</button>
    </div>
  )
}

export function GitPanel(): React.JSX.Element {
  const activeHostId = useSessionsStore((s) => s.activeHostId)
  const active = useSessionsStore((s) => s.active)
  const project = useMemo(() => active.find((r) => r.hostId === activeHostId)?.project ?? null, [active, activeHostId])
  const width = useGitStore((s) => s.width)
  const setWidth = useGitStore((s) => s.setWidth)

  useEffect(() => {
    useGitStore.getState().setProject(project)
  }, [project])

  useEffect(() => {
    if (project === null) return
    const timer = setInterval(() => {
      const git = useGitStore.getState()
      if (!git.busy && !git.generating && !git.loading) void git.refreshStatus(project, true)
    }, 10_000)
    return () => clearInterval(timer)
  }, [project])

  const startResize = (down: React.MouseEvent): void => {
    down.preventDefault()
    const move = (e: MouseEvent): void => setWidth(window.innerWidth - e.clientX)
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const status = useGitStore((s) => s.status)
  const loading = useGitStore((s) => s.loading)
  const message = useGitStore((s) => s.message)
  const generating = useGitStore((s) => s.generating)
  const busy = useGitStore((s) => s.busy)
  const log = useGitStore((s) => s.log)
  const logOpen = useGitStore((s) => s.logOpen)
  const refresh = useGitStore((s) => s.refresh)
  const openFile = useGitStore((s) => s.openFile)
  const stage = useGitStore((s) => s.stage)
  const unstage = useGitStore((s) => s.unstage)
  const commit = useGitStore((s) => s.commit)
  const push = useGitStore((s) => s.push)
  const generate = useGitStore((s) => s.generate)
  const setMessage = useGitStore((s) => s.setMessage)
  const toggleLog = useGitStore((s) => s.toggleLog)

  if (project === null) {
    return (
      <aside className="git-panel" style={{ width }}>
        <div className="git-resizer" onMouseDown={startResize} />
        <div className="panel-hint">Pick a session to see its git status</div>
      </aside>
    )
  }

  const entries = status?.entries ?? []
  const staged = entries.filter((e) => e.index !== '.')
  const changes = entries.filter((e) => e.worktree !== '.' || e.untracked)
  const branchLabel = status === null ? '—' : (status.branch ?? (status.detached ? 'detached' : '—'))

  return (
    <aside className="git-panel" style={{ width }}>
      <div className="git-resizer" onMouseDown={startResize} />
      <div className="git-head">
        <span className="git-branch" title={status?.upstream ?? undefined}>{branchLabel}</span>
        {(status?.ahead ?? 0) > 0 && <span className="git-ab">↑{status?.ahead}</span>}
        {(status?.behind ?? 0) > 0 && <span className="git-ab">↓{status?.behind}</span>}
        <span className="spacer" />
        <button className="icon" title="Refresh" onClick={() => void refresh(project)}>⟲</button>
      </div>
      <ErrorBanner />
      <div className="git-body">
        {loading && status === null && <div className="panel-hint">loading…</div>}
        {!loading && status === null && <div className="panel-hint">Not a git repository</div>}
        {status !== null && (
          <>
            <div className="git-section-title">staged ({staged.length})</div>
            {staged.length === 0 && <div className="panel-hint">nothing staged</div>}
            {staged.map((e) => (
              <FileRow
                key={`s:${e.path}`}
                entry={e}
                badge={e.index}
                action="−"
                onOpen={() => void openFile(project, e.path)}
                onToggle={() => void unstage(project, [e.path])}
              />
            ))}
            <div className="git-section-title">changes ({changes.length})</div>
            {changes.length === 0 && <div className="panel-hint">working tree clean</div>}
            {changes.map((e) => (
              <FileRow
                key={`c:${e.path}`}
                entry={e}
                badge={e.untracked ? '?' : e.worktree}
                action="+"
                onOpen={() => void openFile(project, e.path)}
                onToggle={() => void stage(project, [e.path])}
              />
            ))}
            <div className="git-commit">
              <textarea
                value={message}
                placeholder="Commit message…"
                rows={3}
                onChange={(e) => setMessage(e.target.value)}
              />
              <div className="git-buttons">
                <button className="gen" title="Generate commit message with pi" disabled={generating || busy} onClick={() => void generate(project)}>
                  {generating ? '…' : '✨'}
                </button>
                <button
                  className="commit"
                  disabled={busy || message.trim().length === 0 || staged.length === 0}
                  onClick={() => void commit(project)}
                >
                  Commit
                </button>
                <button className="push" disabled={busy} onClick={() => void push(project)}>Push</button>
              </div>
            </div>
            <div className="git-log">
              <button className="git-log-head" onClick={toggleLog}>{logOpen ? '▾' : '▸'} history</button>
              {logOpen && log.map((e) => (
                <div key={e.hash} className="git-log-entry" title={e.subject}>
                  <span className="git-hash">{e.hash.slice(0, 7)}</span>
                  <span className="git-subject">{e.subject}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </aside>
  )
}
