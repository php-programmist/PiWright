import { useEffect, useMemo, useState } from 'react'
import { useGitStore } from '../../stores/git'
import { useTabsStore, useCenterProject } from '../../stores/tabs'
import { persistPanel } from '../../stores/panels-prefs'
import { useLang, useT } from '../../lib/i18n'
import { BADGE_CLASS } from '../../lib/git-file-class'
import type { GitFileEntry, ProjectEntry, UiLanguage } from '../../../../shared/ipc-contracts'

export function baseName(path: string): string {
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

/** «N файлов» с плюрализацией (en/ru). */
function filesLabel(lang: UiLanguage, count: number): string {
  if (lang === 'ru') {
    const mod10 = count % 10
    const mod100 = count % 100
    const word =
      mod10 === 1 && mod100 !== 11
        ? 'файл'
        : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
          ? 'файла'
          : 'файлов'
    return `${count} ${word}`
  }
  return `${count} ${count === 1 ? 'file' : 'files'}`
}

interface GitFileNode {
  name: string
  dirs: Map<string, GitFileNode>
  files: GitFileEntry[]
}

/** Дерево папок из плоских путей (фича 41): группировка списка изменений по папкам. */
export function buildFileTree(entries: GitFileEntry[]): GitFileNode {
  const root: GitFileNode = { name: '', dirs: new Map(), files: [] }
  for (const entry of entries) {
    const parts = entry.path.split('/')
    let node = root
    for (let i = 0; i < parts.length - 1; i++) {
      const name = parts[i]
      let child = node.dirs.get(name)
      if (child === undefined) {
        child = { name, dirs: new Map(), files: [] }
        node.dirs.set(name, child)
      }
      node = child
    }
    node.files.push(entry)
  }
  return root
}

function subtreeCount(node: GitFileNode): number {
  let total = node.files.length
  for (const child of node.dirs.values()) total += subtreeCount(child)
  return total
}

function FileRow({
  entry,
  badge,
  action,
  depth,
  onOpen,
  onToggle
}: {
  entry: GitFileEntry
  badge: string
  action: string
  depth: number
  onOpen: () => void
  onToggle: () => void
}): React.JSX.Element {
  const t = useT()
  const statusClass = BADGE_CLASS[badge] ?? 'mod'
  return (
    <div className="git-file" style={depth > 0 ? { paddingLeft: 10 + depth * 14 } : undefined} onClick={onOpen}>
      <span className={`git-badge ${statusClass}`}>{badge}</span>
      <span
        className={`git-file-name ${statusClass}`}
        title={entry.origPath !== null ? `${entry.origPath} → ${entry.path}` : entry.path}
      >
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

/** Рекурсивное дерево папок; свёрнутость — Set ключей-путей в GitPanel. */
function FileTree({
  root,
  badgeOf,
  action,
  collapsed,
  toggleCollapsed,
  onOpen,
  onToggle,
  lang
}: {
  root: GitFileNode
  badgeOf: (entry: GitFileEntry) => string
  action: string
  collapsed: Set<string>
  toggleCollapsed: (key: string) => void
  onOpen: (path: string) => void
  onToggle: (path: string) => void
  lang: UiLanguage
}): React.JSX.Element {
  const render = (node: GitFileNode, prefix: string, depth: number): React.JSX.Element[] => {
    const rows: React.JSX.Element[] = []
    const dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name))
    for (const dir of dirs) {
      const key = prefix + dir.name
      const open = !collapsed.has(key)
      rows.push(
        <div key={`d:${key}`} className="git-folder" style={{ paddingLeft: 10 + depth * 14 }} onClick={() => toggleCollapsed(key)}>
          <span className="git-folder-chevron">{open ? '▾' : '▸'}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
          </svg>
          <span className="git-folder-name">{dir.name}</span>
          <span className="git-folder-count">{filesLabel(lang, subtreeCount(dir))}</span>
        </div>
      )
      if (open) rows.push(...render(dir, `${key}/`, depth + 1))
    }
    const files = [...node.files].sort((a, b) => baseName(a.path).localeCompare(baseName(b.path)))
    for (const entry of files) {
      rows.push(
        <FileRow
          key={`f:${entry.path}`}
          entry={entry}
          badge={badgeOf(entry)}
          action={action}
          depth={depth}
          onOpen={() => onOpen(entry.path)}
          onToggle={() => onToggle(entry.path)}
        />
      )
    }
    return rows
  }
  return <>{render(root, '', 0)}</>
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
      {/* Клик по имени ветки при открытом попапе НЕ закрывает его (баг 10): кнопка поднята над
          оверлеем и в открытом состоянии игнорирует клики; закрытие — клик мимо попапа/Escape. */}
      <button
        className={`branch-toggle${open ? ' raised' : ''}`}
        disabled={busy}
        title={branch}
        onClick={() => {
          if (!open) setOpen(true)
        }}
      >
        <span className="branch-toggle-name">{branch}</span>
        <span className="branch-chevron">▾</span>
      </button>
      {open && <div className="popup-overlay" onClick={close} />}
      {open && mode !== 'rename' && (
        <div className="branch-popup">
          {(mode === 'list' || mode === 'submenu') && (
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
  const project = useCenterProject()
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
  const refresh = useGitStore((s) => s.refresh)
  const stage = useGitStore((s) => s.stage)
  const unstage = useGitStore((s) => s.unstage)
  const commit = useGitStore((s) => s.commit)
  const push = useGitStore((s) => s.push)
  const generate = useGitStore((s) => s.generate)
  const setMessage = useGitStore((s) => s.setMessage)
  const entries = useMemo(() => status?.entries ?? [], [status])
  const staged = useMemo(() => entries.filter((e) => e.index !== '.'), [entries])
  const changes = useMemo(() => entries.filter((e) => e.worktree !== '.' || e.untracked), [entries])
  const stagedTree = useMemo(() => buildFileTree(staged), [staged])
  const changesTree = useMemo(() => buildFileTree(changes), [changes])
  const lang = useLang()
  // Свёрнутые папки дерева; смена проекта сбрасывает без эффекта (ключ привязан к проекту).
  const [collapsedState, setCollapsedState] = useState<{ project: ProjectEntry | null; keys: Set<string> }>({
    project: null,
    keys: new Set()
  })
  const collapsed = collapsedState.project === project ? collapsedState.keys : new Set<string>()
  const toggleCollapsed = (key: string): void => {
    setCollapsedState((prev) => {
      const keys = new Set(prev.project === project ? prev.keys : new Set<string>())
      if (keys.has(key)) keys.delete(key)
      else keys.add(key)
      return { project, keys }
    })
  }
  if (project === null) {
    return (
      <aside className="git-panel" style={{ width }}>
        <div className="git-resizer" onMouseDown={startResize} />
        <div className="panel-hint">{t('Pick a session to see its git status')}</div>
      </aside>
    )
  }

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
            <FileTree
              root={stagedTree}
              badgeOf={(e) => e.index}
              action="−"
              collapsed={collapsed}
              toggleCollapsed={toggleCollapsed}
              onOpen={(path) => {
                useTabsStore.getState().openTab(project, { kind: 'diff', path })
                void useGitStore.getState().openFile(project, path)
              }}
              onToggle={(path) => void unstage(project, [path])}
              lang={lang}
            />
            <div className="git-section-title">{t('changes ({count})', { count: changes.length })}</div>
            {changes.length === 0 && <div className="panel-hint">{t('working tree clean')}</div>}
            <FileTree
              root={changesTree}
              badgeOf={(e) => (e.untracked ? '?' : e.worktree)}
              action="+"
              collapsed={collapsed}
              toggleCollapsed={toggleCollapsed}
              onOpen={(path) => {
                useTabsStore.getState().openTab(project, { kind: 'diff', path })
                void useGitStore.getState().openFile(project, path)
              }}
              onToggle={(path) => void stage(project, [path])}
              lang={lang}
            />
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
          </>
        )}
      </div>
    </aside>
  )
}
