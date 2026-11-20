import { useEffect, useMemo, useState } from 'react'
import { useGitStore } from '../../stores/git'
import { useSessionsStore } from '../../stores/sessions'
import { persistPanel } from '../../stores/panels-prefs'
import { useT } from '../../lib/i18n'
import type { GitFileEntry, ProjectEntry } from '../../../../shared/ipc-contracts'

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
  const t = useT()
  return (
    <div className="git-file" onClick={onOpen}>
      <span className={`git-badge ${BADGE_CLASS[badge] ?? 'mod'}`}>{badge}</span>
      <span className="git-file-name" title={entry.origPath !== null ? `${entry.origPath} → ${entry.path}` : entry.path}>
        {baseName(entry.path)}
      </span>
      <button
        className="icon"
        title={action === '+' ? t('Stage') : t('Unstage')}
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

/** Попап веток (референс PHPStorm): поиск, «New branch...», клик по ветке — подменю
 *  (Checkout / New Branch from / Rename / Delete; у текущей — без Checkout и Delete). */
function BranchSelect({ project, branch, detached }: { project: ProjectEntry; branch: string | null; detached: boolean }): React.JSX.Element {
  const branches = useGitStore((s) => s.branches)
  const busy = useGitStore((s) => s.busy)
  const checkout = useGitStore((s) => s.checkout)
  const renameBranch = useGitStore((s) => s.renameBranch)
  const deleteBranch = useGitStore((s) => s.deleteBranch)
  const t = useT()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'list' | 'submenu' | 'new' | 'rename'>('list')
  const [target, setTarget] = useState<string | null>(null)
  const [startFrom, setStartFrom] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [name, setName] = useState('')

  if (branch === null || detached) return <span className="git-branch">detached</span>

  const close = (): void => {
    setOpen(false)
    setMode('list')
    setTarget(null)
    setStartFrom(null)
    setFilter('')
    setName('')
  }
  const filtered = branches.filter((b) => b.toLowerCase().includes(filter.toLowerCase()))

  const createBranch = (): void => {
    const trimmed = name.trim()
    if (trimmed.length === 0) return
    void checkout(project, trimmed, true, startFrom ?? undefined)
    close()
  }

  return (
    <div className="branch-wrap">
      <button className="branch-toggle" disabled={busy} title={branch} onClick={() => (open ? close() : setOpen(true))}>
        <span className="branch-toggle-name">{branch}</span>
        <span className="branch-chevron">▾</span>
      </button>
      {open && <div className="popup-overlay" onClick={close} />}
      {open && mode !== 'rename' && (
        <div className="branch-popup">
          {mode === 'list' && (
            <>
              <input
                className="branch-search"
                autoFocus
                placeholder={t('Search branches')}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') close()
                }}
              />
              <button
                className="branch-item"
                onClick={() => {
                  setStartFrom(null)
                  setName('')
                  setMode('new')
                }}
              >
                <span className="branch-glyph">+</span>
                <span>{t('New branch...')}</span>
              </button>
              {filtered.map((b) => (
                <button
                  key={b}
                  className={`branch-item${b === branch ? ' current' : ''}`}
                  onClick={() => {
                    setTarget(b)
                    setMode('submenu')
                  }}
                >
                  <span className={`branch-glyph${b === branch ? ' star' : ''}`}>{b === branch ? '★' : '⑂'}</span>
                  <span className="branch-item-name">{b}</span>
                </button>
              ))}
              {filtered.length === 0 && <div className="panel-hint">{t('no branches')}</div>}
            </>
          )}
          {mode === 'new' && (
            <input
              className="branch-search"
              autoFocus
              value={name}
              placeholder={startFrom !== null ? t('new branch from {name}', { name: startFrom }) : t('new branch name')}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createBranch()
                if (e.key === 'Escape') {
                  setMode('list')
                  setName('')
                }
              }}
              onBlur={createBranch}
            />
          )}
        </div>
      )}
      {open && mode === 'submenu' && target !== null && (
        <div className="branch-sub">
          <button className="branch-item back" onClick={() => setMode('list')}>
            <span className="branch-glyph">‹</span>
            <span className="branch-item-name">{target}</span>
          </button>
          {target !== branch && (
            <button
              className="branch-item"
              onClick={() => {
                void checkout(project, target, false)
                close()
              }}
            >
              <span className="branch-glyph" />
              <span>{t('Checkout')}</span>
            </button>
          )}
          <button
            className="branch-item"
            onClick={() => {
              setStartFrom(target)
              setName('')
              setMode('new')
            }}
          >
            <span className="branch-glyph" />
            <span>{t('New Branch from {name}...', { name: target })}</span>
          </button>
          <button
            className="branch-item"
            onClick={() => {
              setName(target)
              setMode('rename')
            }}
          >
            <span className="branch-glyph" />
            <span>{t('Rename...')}</span>
          </button>
          {target !== branch && (
            <button
              className="branch-item danger"
              onClick={() => {
                void deleteBranch(project, target)
                close()
              }}
            >
              <span className="branch-glyph" />
              <span>{t('Delete')}</span>
            </button>
          )}
        </div>
      )}
      {open && mode === 'rename' && target !== null && (
        <div className="branch-sub">
          <div className="branch-rename-head">{t('Rename {name}', { name: target })}</div>
          <input
            className="branch-search"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const to = name.trim()
                if (to.length > 0 && to !== target) void renameBranch(project, target, to)
                close()
              }
              if (e.key === 'Escape') setMode('submenu')
            }}
          />
        </div>
      )}
    </div>
  )
}

export function GitPanel(): React.JSX.Element {
  const activeHostId = useSessionsStore((s) => s.activeHostId)
  const active = useSessionsStore((s) => s.active)
  const project = useMemo(() => active.find((r) => r.hostId === activeHostId)?.project ?? null, [active, activeHostId])
  const width = useGitStore((s) => s.width)
  const setWidth = useGitStore((s) => s.setWidth)
  const t = useT()

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
      persistPanel('git', { width: useGitStore.getState().width })
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
        <div className="panel-hint">{t('Pick a session to see its git status')}</div>
      </aside>
    )
  }

  const entries = status?.entries ?? []
  const staged = entries.filter((e) => e.index !== '.')
  const changes = entries.filter((e) => e.worktree !== '.' || e.untracked)

  return (
    <aside className="git-panel" style={{ width }}>
      <div className="git-resizer" onMouseDown={startResize} />
      <div className="git-head">
        <BranchSelect project={project} branch={status?.branch ?? null} detached={status?.detached ?? false} />
        {(status?.ahead ?? 0) > 0 && <span className="git-ab">↑{status?.ahead}</span>}
        {(status?.behind ?? 0) > 0 && <span className="git-ab">↓{status?.behind}</span>}
        <span className="spacer" />
        <button className="icon" title={t('Refresh')} onClick={() => void refresh(project)}>⟲</button>
      </div>
      <ErrorBanner />
      <div className="git-body">
        {loading && status === null && <div className="panel-hint">{t('loading…')}</div>}
        {!loading && status === null && <div className="panel-hint">{t('Not a git repository')}</div>}
        {status !== null && (
          <>
            <div className="git-section-title">{t('staged ({count})', { count: staged.length })}</div>
            {staged.length === 0 && <div className="panel-hint">{t('nothing staged')}</div>}
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
            <div className="git-section-title">{t('changes ({count})', { count: changes.length })}</div>
            {changes.length === 0 && <div className="panel-hint">{t('working tree clean')}</div>}
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
                placeholder={t('Commit message…')}
                rows={3}
                onChange={(e) => setMessage(e.target.value)}
              />
              <div className="git-buttons">
                <button className="gen" title={t('Generate commit message with pi')} disabled={generating || busy} onClick={() => void generate(project)}>
                  {generating ? '…' : '✨'}
                </button>
                <button
                  className="commit"
                  disabled={busy || message.trim().length === 0 || staged.length === 0}
                  onClick={() => void commit(project)}
                >
                  {t('Commit')}
                </button>
                <button className="push" disabled={busy} onClick={() => void push(project)}>Push</button>
              </div>
            </div>
            <div className="git-log">
              <button className="git-log-head" onClick={toggleLog}>{logOpen ? '▾' : '▸'} {t('history')}</button>
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
