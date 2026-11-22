/** Док Git Log внизу экрана (референс PHPStorm): граф веток, клик по коммиту — детали
 *  со списком изменений сбоку, клик по файлу — дифф во вкладке. Взаимоисключаем с терминалом. */
import { useEffect, useMemo } from 'react'
import { useGitLogStore } from '../../stores/gitlog'
import { useTabsStore, useCenterProject } from '../../stores/tabs'
import { persistPanel } from '../../stores/panels-prefs'
import { useLang, useT } from '../../lib/i18n'
import { computeLanes, formatGitDate, laneColor, type LaneRow } from './git-log-model'
import { BADGE_CLASS } from '../../lib/git-file-class'
import type { GitCommitFileEntry, GitLogEntry } from '../../../../shared/ipc-contracts'

const LANE_STEP = 14
const ROW_HEIGHT = 22

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
  return (
    <svg width={width} height={ROW_HEIGHT} className="gitlog-graph" aria-hidden="true">
      {lines}
      {curves}
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
  onSelect
}: {
  entry: GitLogEntry
  row: LaneRow
  maxLanes: number
  selected: boolean
  onSelect: (hash: string | null) => void
}): React.JSX.Element {
  const lang = useLang()
  return (
    <div
      className={`gitlog-row${selected ? ' selected' : ''}`}
      onClick={() => onSelect(selected ? null : entry.hash)}
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
  const t = useT()
  const lang = useLang()

  useEffect(() => {
    useGitLogStore.getState().setProject(project)
  }, [project])

  useEffect(() => {
    const gl = useGitLogStore.getState()
    if (project !== null && gl.open && gl.entries.length === 0 && !gl.loading) void gl.refresh(project)
  }, [project])

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
  const selected = useMemo(() => entries.find((e) => e.hash === selectedHash) ?? null, [entries, selectedHash])

  const openCommitDiff = (path: string): void => {
    if (project === null || selectedHash === null) return
    useTabsStore.getState().openTab(project, { kind: 'diff', path, hash: selectedHash })
  }

  const select = (hash: string | null): void => {
    if (project === null) return
    void useGitLogStore.getState().select(project, hash)
  }

  if (project === null) {
    return (
      <aside className="terminal-dock gitlog-dock" style={{ height }}>
        <div className="terminal-resizer" onMouseDown={startResize} />
        <div className="gitlog-head">
          <span className="gitlog-title">{t('Git Log')}</span>
          <span className="spacer" />
          <button
            className="term-new term-collapse"
            title={t('Collapse git log')}
            onClick={() => {
              useGitLogStore.getState().toggleOpen()
              persistPanel('gitlog', { open: false })
            }}
          >
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
        <span className="spacer" />
        <button className="icon" title={t('Refresh')} onClick={() => void useGitLogStore.getState().refresh(project)}>⟲</button>
        <button
          className="term-new term-collapse"
          title={t('Collapse git log')}
          onClick={() => {
            useGitLogStore.getState().toggleOpen()
            persistPanel('gitlog', { open: false })
          }}
        >
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
        <div className={`gitlog-list${selectedHash !== null ? ' narrowed' : ''}`}>
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
            />
          ))}
        </div>
        {selectedHash !== null && (
          <div className="gitlog-details">
            {selected === null ? (
              <div className="panel-hint">{t('loading…')}</div>
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
    </aside>
  )
}
