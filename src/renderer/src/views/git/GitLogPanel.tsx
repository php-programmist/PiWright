/** Док Git Log внизу экрана (референс PHPStorm): граф веток, клик по коммиту — детали
 *  со списком изменений сбоку, клик по файлу — дифф во вкладке. Поиск по сообщению/хэшу,
 *  фильтр веток, ПКМ по коммиту — контекстное меню действий. Взаимоисключаем с терминалом. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useGitLogStore } from '../../stores/gitlog'
import { useGitStore } from '../../stores/git'
import { useTerminalStore } from '../../stores/terminal'
import { useTabsStore, useCenterProject } from '../../stores/tabs'
import { persistPanel } from '../../stores/panels-prefs'
import { useLang, useT } from '../../lib/i18n'
import { confirmDialog } from '../../components/ConfirmDialog'
import { renameDialog } from '../../components/RenameDialog'
import { computeLanes, formatGitDate, laneColor, type LaneRow } from './git-log-model'
import { BADGE_CLASS } from '../../lib/git-file-class'
import type { GitCommitFileEntry, GitLogEntry, GitOpResult } from '../../../../shared/ipc-contracts'

const LANE_STEP = 14
const ROW_HEIGHT = 22

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
  }
}

/** SVG графа одной строки: вертикали дорожек, точка коммита, кривые к родителям. */
function LaneGraph({ row, maxLanes }: { row: LaneRow; maxLanes: number }): React.JSX.Element {
  const width = Math.max(maxLanes, row.nextLanes.length) * LANE_STEP + 4
  const x = (lane: number): number => lane * LANE_STEP + 8
  const midY = ROW_HEIGHT / 2
  const lines: React.JSX.Element[] = []
  for (let c = 0; c < row.nextLanes.length; c++) {
    if (row.nextLanes[c] === null) continue
    lines.push(
      <line key={`v${c}`} x1={x(c)} y1={0} x2={x(c)} y2={ROW_HEIGHT} stroke={laneColor(c)} strokeWidth={1.5} />
    )
  }
  // Вход в точку: дорожка коммита могла закончиться в этой строке (nextLanes[lane] уже родитель).
  if (row.nextLanes[row.lane] === null || row.lane >= row.nextLanes.length) {
    lines.push(
      <line key="in" x1={x(row.lane)} y1={0} x2={x(row.lane)} y2={midY} stroke={laneColor(row.lane)} strokeWidth={1.5} />
    )
  }
  const curves = row.edges
    .filter((target) => target !== row.lane)
    .map((target, i) => (
      <path
        key={`e${i}:${target}`}
        d={`M ${x(row.lane)} ${midY} C ${x(row.lane)} ${ROW_HEIGHT}, ${x(target)} 0, ${x(target)} ${ROW_HEIGHT}`}
        fill="none"
        stroke={laneColor(target)}
        strokeWidth={1.5}
      />
    ))
  // Сходящиеся ветки: линия ребёнка сверху входит в точку этого коммита и заканчивается.
  const ins = row.inLanes.map((source, i) => (
    <path
      key={`i${i}:${source}`}
      d={`M ${x(source)} 0 C ${x(source)} ${midY}, ${x(row.lane)} ${midY}, ${x(row.lane)} ${midY}`}
      fill="none"
      stroke={laneColor(source)}
      strokeWidth={1.5}
    />
  ))
  return (
    <svg width={width} height={ROW_HEIGHT} className="gitlog-graph" aria-hidden="true">
      {lines}
      {curves}
      {ins}
      <circle cx={x(row.lane)} cy={midY} r={3.5} fill={laneColor(row.lane)} />
    </svg>
  )
}

function RefChip({ label }: { label: string }): React.JSX.Element {
  const name = label.startsWith('HEAD -> ') ? label.slice('HEAD -> '.length) : label
  const tag = label.startsWith('tag: ')
  return (
    <span className={`gitlog-ref${label.startsWith('HEAD -> ') ? ' current' : ''}${tag ? ' tag' : ''}`}>
      {tag ? name.slice('tag: '.length) : name}
    </span>
  )
}

function CommitRow({
  entry,
  row,
  maxLanes,
  selected,
  onSelect,
  onMenu
}: {
  entry: GitLogEntry
  row: LaneRow
  maxLanes: number
  selected: boolean
  onSelect: (hash: string | null) => void
  onMenu: (entry: GitLogEntry, x: number, y: number) => void
}): React.JSX.Element {
  const lang = useLang()
  const rowRef = useRef<HTMLDivElement | null>(null)
  // Навигация «к родителю/потомку» может увести выбор за пределы видимости.
  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])
  return (
    <div
      ref={rowRef}
      className={`gitlog-row${selected ? ' selected' : ''}`}
      onClick={() => onSelect(selected ? null : entry.hash)}
      onContextMenu={(e) => {
        e.preventDefault()
        onMenu(entry, e.clientX, e.clientY)
      }}
      title={entry.subject}
    >
      <span className="gitlog-author">{entry.author}</span>
      <span className="gitlog-date">{formatGitDate(entry.date, lang)}</span>
      <LaneGraph row={row} maxLanes={maxLanes} />
      <span className="gitlog-subject">{entry.subject}</span>
      <span className="gitlog-refs">
        {entry.refs.map((r) => (
          <RefChip key={r} label={r} />
        ))}
      </span>
    </div>
  )
}

function FileRow({ entry, onOpen }: { entry: GitCommitFileEntry; onOpen: (path: string) => void }): React.JSX.Element {
  return (
    <div className="gitlog-file" onClick={() => onOpen(entry.path)} title={entry.origPath !== null ? `${entry.origPath} → ${entry.path}` : entry.path}>
      <span className={`git-badge ${BADGE_CLASS[entry.status] ?? 'mod'}`}>{entry.status}</span>
      <span className="gitlog-file-path">{entry.path}</span>
    </div>
  )
}

interface MenuState {
  x: number
  y: number
  hash: string
}

export function GitLogPanel(): React.JSX.Element {
  const project = useCenterProject()
  const height = useGitLogStore((s) => s.height)
  const setHeight = useGitLogStore((s) => s.setHeight)
  const entries = useGitLogStore((s) => s.entries)
  const loading = useGitLogStore((s) => s.loading)
  const error = useGitLogStore((s) => s.error)
  const selectedHash = useGitLogStore((s) => s.selectedHash)
  const files = useGitLogStore((s) => s.files)
  const filesLoading = useGitLogStore((s) => s.filesLoading)
  const branch = useGitLogStore((s) => s.branch)
  const allBranches = useGitLogStore((s) => s.allBranches)
  const branchList = useGitLogStore((s) => s.branches)
  const repos = useGitLogStore((s) => s.repos)
  const repo = useGitLogStore((s) => s.repo)
  const dockOpen = useGitLogStore((s) => s.open)
  const t = useT()
  const lang = useLang()

  const [search, setSearch] = useState('')
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [resetHash, setResetHash] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    useGitLogStore.getState().setProject(project)
  }, [project])

  useEffect(() => {
    const gl = useGitLogStore.getState()
    if (project !== null && gl.open && gl.entries.length === 0 && !gl.loading) void gl.refresh(project)
  }, [project])

  // Локальное поле поиска очищается при смене проекта — инпут перемонтируется по key.

  // Дебаунс поиска: 300 мс после последнего нажатия.
  useEffect(() => {
    const handle = setTimeout(() => {
      if (project !== null) void useGitLogStore.getState().setQuery(project, search.trim())
    }, 300)
    return () => clearTimeout(handle)
  }, [search, project])

  useEffect(() => {
    if (project !== null && dockOpen) {
      void useGitLogStore.getState().loadRepos(project)
      void useGitLogStore.getState().loadBranches(project)
    }
  }, [project, dockOpen])

  // Закрытие контекстного меню: клик мимо или Escape.
  useEffect(() => {
    if (menu === null) return
    const onDown = (e: MouseEvent): void => {
      if (menuRef.current !== null && !menuRef.current.contains(e.target as Node)) {
        setMenu(null)
        setResetHash(null)
      }
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setMenu(null)
        setResetHash(null)
      }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const startResize = (down: React.MouseEvent): void => {
    down.preventDefault()
    const move = (e: MouseEvent): void => setHeight(window.innerHeight - e.clientY)
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      persistPanel('gitlog', { height: useGitLogStore.getState().height })
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'row-resize'
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const rows = useMemo(() => computeLanes(entries), [entries])
  const maxLanes = useMemo(() => rows.reduce((max, r) => Math.max(max, r.nextLanes.length), 3), [rows])
  // selectedHash приходит из канбан-чипов коротким (7 символов) — матчим и по префиксу.
  const selected = useMemo(
    () =>
      selectedHash === null
        ? null
        : (entries.find((e) => e.hash === selectedHash) ??
          entries.find((e) => e.hash.startsWith(selectedHash)) ??
          null),
    [entries, selectedHash]
  )
  const hasMore = useGitLogStore((s) => s.hasMore)
  const loadingMore = useGitLogStore((s) => s.loadingMore)

  const onScroll = (e: React.UIEvent<HTMLDivElement>): void => {
    if (!hasMore || loadingMore || project === null) return
    const el = e.currentTarget
    if (el.scrollTop + el.clientHeight < el.scrollHeight - 200) return
    void useGitLogStore.getState().loadMore(project)
  }

  const openCommitDiff = (path: string): void => {
    if (project === null || selectedHash === null) return
    useTabsStore.getState().openTab(project, { kind: 'diff', path, hash: selectedHash, repo: repo.length > 0 ? repo : undefined })
  }

  const select = (hash: string | null): void => {
    if (project === null) return
    void useGitLogStore.getState().select(project, hash)
  }

  const menuEntry = menu === null ? null : (entries.find((e) => e.hash === menu.hash) ?? null)
  const isRoot = menuEntry !== null && menuEntry.parents.length === 0
  const checkedOut = menuEntry?.refs.find((r) => r.startsWith('HEAD -> '))?.slice('HEAD -> '.length) ?? null
  const branchRefs = menuEntry?.refs.filter((r) => !r.startsWith('HEAD -> ') && !r.startsWith('tag: ')) ?? []
  const localRefs = branchRefs.filter((r) => branchList.includes(r) && r !== checkedOut)
  const remoteRefs = branchRefs.filter((r) => !branchList.includes(r))
  const menuChild =
    menuEntry !== null ? (entries.find((e) => e.parents.includes(menuEntry.hash)) ?? null) : null
  const menuParent =
    menuEntry !== null && menuEntry.parents.length > 0
      ? (entries.find((e) => e.hash === menuEntry.parents[0]) ?? null)
      : null

  /** Прогнать git-операцию и обновить историю + статус-панель. */
  const runOp = async (op: () => Promise<GitOpResult>): Promise<void> => {
    if (project === null) return
    setMenu(null)
    setResetHash(null)
    const result = await op()
    const gl = useGitLogStore.getState()
    if (!result.ok) gl.setError(result.error)
    await gl.refresh(project)
    void useGitStore.getState().refresh(project)
  }

  const openMenu = (entry: GitLogEntry, x: number, y: number): void => {
    setResetHash(null)
    setMenu({ x, y, hash: entry.hash })
  }

  const editMessage = async (): Promise<void> => {
    if (project === null || menuEntry === null) return
    const message = await renameDialog({
      title: t('Edit commit message'),
      initial: menuEntry.subject,
      confirmLabel: t('OK')
    })
    if (message === null) return
    void runOp(() => window.piwright.gitEditCommitMessage(project, menuEntry.hash, message))
  }

  const squashInto = async (): Promise<void> => {
    if (project === null || menuEntry === null) return
    const parent = entries.find((e) => e.hash === menuEntry.parents[0])
    const message = await renameDialog({
      title: t('Squash into parent commit'),
      initial: parent?.subject ?? menuEntry.subject,
      confirmLabel: t('OK')
    })
    if (message === null) return
    void runOp(() => window.piwright.gitSquashInto(project, menuEntry.hash, message))
  }

  const dropCommit = async (): Promise<void> => {
    if (project === null || menuEntry === null) return
    const ok = await confirmDialog({
      message: t('Drop this commit? Its changes will be removed from the branch history.'),
      confirmLabel: t('Drop'),
      danger: true
    })
    if (!ok) return
    void runOp(() => window.piwright.gitDropCommit(project, menuEntry.hash))
  }

  const newBranch = async (): Promise<void> => {
    if (project === null || menuEntry === null) return
    const name = await renameDialog({ title: t('new branch name'), initial: '', confirmLabel: t('Create') })
    if (name === null) return
    void runOp(() => window.piwright.gitCheckout(project, name, true, menuEntry.hash))
  }

  const newTag = async (): Promise<void> => {
    if (project === null || menuEntry === null) return
    const name = await renameDialog({ title: t('New tag'), initial: '', confirmLabel: t('Create') })
    if (name === null) return
    void runOp(() => window.piwright.gitTagCreate(project, name, menuEntry.hash))
  }

  const interactiveRebase = async (): Promise<void> => {
    if (project === null || menuEntry === null) return
    setMenu(null)
    setResetHash(null)
    const id = await useTerminalStore.getState().spawn(project)
    if (id !== null) {
      const cd = repo.length > 0 ? `cd ${JSON.stringify(repo)} && ` : ''
      window.piwright.termInput(id, `${cd}git rebase -i ${menuEntry.hash}\n`)
    }
  }

  const collapse = (): void => {
    useGitLogStore.getState().toggleOpen()
    persistPanel('gitlog', { open: false })
  }

  if (project === null) {
    return (
      <aside className="terminal-dock gitlog-dock" style={{ height }}>
        <div className="terminal-resizer" onMouseDown={startResize} />
        <div className="gitlog-head">
          <span className="gitlog-title">{t('Git Log')}</span>
          <span className="spacer" />
          <button className="term-new term-collapse" title={t('Collapse git log')} onClick={collapse}>
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <line x1="1.5" y1="5" x2="8.5" y2="5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="panel-hint">{t('Pick a session to see its git history')}</div>
      </aside>
    )
  }

  return (
    <aside className="terminal-dock gitlog-dock" style={{ height }}>
      <div className="terminal-resizer" onMouseDown={startResize} />
      <div className="gitlog-head">
        <span className="gitlog-title">{t('Git Log')}</span>
        <div className="gitlog-search-wrap">
          <input
            key={`${project.kind}:${project.dir}`}
            className="gitlog-search"
            type="text"
            placeholder={t('Search commits (message or hash)')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search.length > 0 && (
            <button className="gitlog-search-clear" title={t('Clear')} onClick={() => setSearch('')}>
              ×
            </button>
          )}
        </div>
        {repos.length > 1 && (
          <select
            className="gitlog-repo-select"
            value={repo}
            title={t('Repository filter')}
            onChange={(e) => {
              if (project !== null) void useGitLogStore.getState().setRepo(project, e.target.value)
            }}
          >
            {repos.map((r) => (
              <option key={r.rel} value={r.rel}>
                {r.name}
              </option>
            ))}
          </select>
        )}
        <select
          className="gitlog-branch-select"
          value={allBranches ? '*' : (branch ?? '')}
          title={t('Branch filter')}
          onChange={(e) => {
            const v = e.target.value
            void useGitLogStore
              .getState()
              .setBranchFilter(project, v === '' || v === '*' ? null : v, v === '*')
          }}
        >
          <option value="">{t('HEAD (current)')}</option>
          <option value="*">{t('All branches')}</option>
          {branchList.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <button className="icon" title={t('Refresh')} onClick={() => void useGitLogStore.getState().refresh(project)}>⟲</button>
        <button className="term-new term-collapse" title={t('Collapse git log')} onClick={collapse}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <line x1="1.5" y1="5" x2="8.5" y2="5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {error !== null && (
        <div className="git-error">
          <span>{error}</span>
          <button className="icon" onClick={() => useGitLogStore.getState().setError(null)}>×</button>
        </div>
      )}
      <div className="gitlog-body">
        <div className={`gitlog-list${selectedHash !== null ? ' narrowed' : ''}`} onScroll={onScroll}>
          {loading && entries.length === 0 && <div className="panel-hint">{t('loading…')}</div>}
          {!loading && entries.length === 0 && <div className="panel-hint">{t('no commits')}</div>}
          {rows.map((row, i) => (
            <CommitRow
              key={entries[i]!.hash}
              entry={entries[i]!}
              row={row}
              maxLanes={maxLanes}
              selected={entries[i]!.hash === selectedHash}
              onSelect={select}
              onMenu={openMenu}
            />
          ))}
          {loadingMore && <div className="panel-hint gitlog-more">{t('loading…')}</div>}
        </div>
        {selectedHash !== null && (
          <div className="gitlog-details">
            {selected === null ? (
              <div className="panel-hint">
                {loading || entries.length === 0 ? t('loading…') : t('commit not found in loaded history')}
              </div>
            ) : (
              <>
                <div className="gitlog-commit-head">
                  <div className="gitlog-commit-subject" title={selected.subject}>{selected.subject}</div>
                  <div className="gitlog-commit-meta">
                    {selected.author} · {formatGitDate(selected.date, lang)} · {selected.hash.slice(0, 7)}
                  </div>
                  {selected.refs.length > 0 && (
                    <div className="gitlog-commit-refs">
                      {selected.refs.map((r) => (
                        <RefChip key={r} label={r} />
                      ))}
                    </div>
                  )}
                </div>
                <div className="gitlog-files-title">{t('changed files ({count})', { count: files.length })}</div>
                <div className="gitlog-files">
                  {filesLoading && <div className="panel-hint">{t('loading…')}</div>}
                  {!filesLoading && files.length === 0 && <div className="panel-hint">{t('no files in commit')}</div>}
                  {files.map((f) => (
                    <FileRow key={`${f.status}:${f.path}`} entry={f} onOpen={openCommitDiff} />
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {menu !== null && menuEntry !== null && (
        <div ref={menuRef}>
          <div
            className="files-menu gitlog-menu"
            style={{
              left: Math.max(4, Math.min(menu.x, window.innerWidth - 240)),
              // Меню длинное (~13 пунктов) — поднимаем, чтобы нижние пункты не ушли за край
              top: Math.max(4, Math.min(menu.y, window.innerHeight - 440))
            }}
          >
            <button
              className="project-menu-item"
              onClick={() => {
                void copyText(menuEntry.hash)
                setMenu(null)
              }}
            >
              {t('Copy Revision Number')}
            </button>
            <button
              className="project-menu-item"
              onClick={() => void runOp(() => window.piwright.gitCherryPick(project, menuEntry.hash))}
            >
              {t('Cherry-Pick')}
            </button>
            <div className="project-menu-sep" />
            <button
              className="project-menu-item"
              onClick={() => void runOp(() => window.piwright.gitCheckout(project, menuEntry.hash, false))}
            >
              {t('Checkout Revision')}
            </button>
            <button className="project-menu-item" onClick={() => setResetHash(menuEntry.hash)}>
              {t('Reset Current Branch to Here...')}
            </button>
            <button
              className="project-menu-item"
              onClick={() => void runOp(() => window.piwright.gitRevert(project, menuEntry.hash))}
            >
              {t('Revert Commit')}
            </button>
            <div className="project-menu-sep" />
            <button className="project-menu-item" disabled={isRoot} onClick={() => void editMessage()}>
              {t('Edit Commit Message...')}
            </button>
            <button className="project-menu-item" disabled={isRoot} onClick={() => void squashInto()}>
              {t('Squash Into...')}
            </button>
            <button className="project-menu-item" disabled={isRoot} onClick={() => void dropCommit()}>
              {t('Drop Commit')}
            </button>
            <button className="project-menu-item" onClick={() => void interactiveRebase()}>
              {t('Interactively Rebase from Here...')}
            </button>
            {(localRefs.length > 0 || remoteRefs.length > 0) && <div className="project-menu-sep" />}
            {localRefs.map((r) => (
              <button
                key={r}
                className="project-menu-item"
                onClick={() => void runOp(() => window.piwright.gitCheckout(project, r, false))}
              >
                {t("Checkout '{name}'", { name: r })}
              </button>
            ))}
            {remoteRefs.map((r) => (
              <button
                key={r}
                className="project-menu-item"
                onClick={() =>
                  void runOp(() => window.piwright.gitCheckout(project, r.slice(r.indexOf('/') + 1), false))
                }
              >
                {t("Checkout '{name}'", { name: r })}
              </button>
            ))}
            <div className="project-menu-sep" />
            <button className="project-menu-item" onClick={() => void newBranch()}>
              {t('New Branch...')}
            </button>
            <button className="project-menu-item" onClick={() => void newTag()}>
              {t('New Tag...')}
            </button>
            <div className="project-menu-sep" />
            <button
              className="project-menu-item"
              disabled={menuChild === null}
              onClick={() => {
                if (menuChild !== null) select(menuChild.hash)
                setMenu(null)
              }}
            >
              {t('Go to Child Commit')}
            </button>
            <button
              className="project-menu-item"
              disabled={menuParent === null}
              onClick={() => {
                if (menuParent !== null) select(menuParent.hash)
                setMenu(null)
              }}
            >
              {t('Go to Parent Commit')}
            </button>
          </div>
          {resetHash !== null && (
            <div
              className="files-menu gitlog-menu"
              style={{
                left: Math.max(4, Math.min(menu.x + 230, window.innerWidth - 240)),
                top: Math.max(4, Math.min(menu.y, window.innerHeight - 120))
              }}
            >
              <button
                className="project-menu-item"
                onClick={() => void runOp(() => window.piwright.gitReset(project, resetHash, 'soft'))}
              >
                {t('Soft — keep changes staged')}
              </button>
              <button
                className="project-menu-item"
                onClick={() => void runOp(() => window.piwright.gitReset(project, resetHash, 'mixed'))}
              >
                {t('Mixed — keep changes unstaged')}
              </button>
              <button
                className="project-menu-item danger"
                onClick={() => {
                  void confirmDialog({
                    message: t('Hard reset discards all uncommitted changes. Continue?'),
                    confirmLabel: t('Reset'),
                    danger: true
                  }).then((ok) => {
                    if (ok) void runOp(() => window.piwright.gitReset(project, resetHash, 'hard'))
                  })
                }}
              >
                {t('Hard — discard all changes')}
              </button>
            </div>
          )}
        </div>
      )}
    </aside>
  )
}
