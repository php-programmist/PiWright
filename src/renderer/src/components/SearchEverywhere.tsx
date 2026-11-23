/** Двойной Shift — «поиск везде» (как в PHPStorm): файлы, сессии и карточки канбанов
 *  текущего проекта в одном списке, нечёткий фильтр, до 20 элементов. Пустой запрос —
 *  недавние сессии и карточки. Enter/клик — открыть, Esc — закрыть. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { TAB_ICONS } from './TabBar'
import { fuzzyMatch } from '../lib/fuzzy'
import { useLang, useT } from '../lib/i18n'
import { projectKey, useSessionsStore } from '../stores/sessions'
import { parentTabKey, useCenterProject, useTabsStore } from '../stores/tabs'
import { useFilesStore } from '../stores/files'
import { useKanbanStore } from '../stores/kanban'
import type { ProjectEntry, SessionSummary } from '../../../shared/ipc-contracts'
import type { KanbanBoard, KanbanCard } from '../../../shared/kanban'

const MAX_RESULTS = 20
const DOUBLE_SHIFT_MS = 600

const SESSION_ICON = (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6a1.5 1.5 0 0 1-1.5 1.5H8.4L5 13.6V11H3.5A1.5 1.5 0 0 1 2 9.5v-6Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    />
  </svg>
)

interface CardRef {
  card: KanbanCard
  boardId: string
  boardName: string
  columnName: string
}

interface LoadedData {
  project: ProjectEntry
  files: string[]
  sessions: SessionSummary[]
  cards: CardRef[]
}

interface ResultItem {
  key: string
  kind: 'file' | 'session' | 'card'
  title: string
  sub: string | null
  score: number
  positions: number[]
  open: () => void
}

function formatDate(ts: number, lang: string): string {
  return new Date(ts).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function Highlight({ text, positions }: { text: string; positions: number[] }): React.JSX.Element {
  if (positions.length === 0) return <>{text}</>
  const matched = new Set(positions)
  return (
    <>
      {text.split('').map((ch, i) => (matched.has(i) ? <b key={i}>{ch}</b> : <span key={i}>{ch}</span>))}
    </>
  )
}

function itemIcon(kind: ResultItem['kind']): React.JSX.Element {
  if (kind === 'file') return TAB_ICONS.file
  if (kind === 'card') return TAB_ICONS.kanban
  return SESSION_ICON
}

function openSession(p: ProjectEntry, summary: SessionSummary): void {
  void (async () => {
    const result = await window.piwright.openSession(p, summary.path)
    if (!result.ok) {
      if (result.error !== null) window.alert(result.error)
      return
    }
    useTabsStore.getState().setActiveProject(parentTabKey(p))
    useTabsStore.getState().activateSession(p)
    useSessionsStore.getState().setActive(result.hostId)
  })()
}

function openFile(p: ProjectEntry, path: string): void {
  const ts = useTabsStore.getState()
  ts.setActiveProject(parentTabKey(p))
  ts.openTab(p, { kind: 'file', path })
  void useFilesStore.getState().openFile(p, path)
}

function openCard(p: ProjectEntry, c: CardRef): void {
  const ts = useTabsStore.getState()
  ts.setActiveProject(parentTabKey(p))
  ts.openTab(p, { kind: 'kanban', boardId: c.boardId, title: c.boardName })
  useKanbanStore.getState().setOpenCard(`${projectKey(p)}\u0000${c.boardId}`, c.card.id)
}

export function SearchEverywhereHost(): React.JSX.Element | null {
  const t = useT()
  const lang = useLang()
  const project = useCenterProject()
  const projectRef = useRef(project)
  projectRef.current = project
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [data, setData] = useState<LoadedData | null>(null)
  const [index, setIndex] = useState(0)
  const openRef = useRef(false)
  const loadSeq = useRef(0)
  const listRef = useRef<HTMLDivElement | null>(null)
  openRef.current = open

  const close = (): void => {
    setOpen(false)
    setData(null)
    setQuery('')
    setIndex(0)
    loadSeq.current++
  }

  const openOverlay = async (): Promise<void> => {
    const target = projectRef.current
    if (target === null) return
    const seq = ++loadSeq.current
    setQuery('')
    setIndex(0)
    setLoading(true)
    setOpen(true)
    const [filesRes, sessions] = await Promise.all([
      window.piwright.filesSearch(target),
      window.piwright.sessionHistory(target)
    ])
    if (seq !== loadSeq.current) return
    const boardsRes = await window.piwright.kanbanBoards(target)
    if (seq !== loadSeq.current) return
    const boards = boardsRes.ok
      ? (await Promise.all(
          boardsRes.boards.map(async (b): Promise<KanbanBoard | null> => {
            const res = await window.piwright.kanbanBoardGet(target, b.id)
            return res.ok && res.board !== null ? res.board : null
          })
        )).filter((b): b is KanbanBoard => b !== null)
      : []
    if (seq !== loadSeq.current) return
    const cards: CardRef[] = boards.flatMap((b) =>
      b.cards.map((card) => ({
        card,
        boardId: b.id,
        boardName: b.name,
        columnName: b.columns.find((col) => col.id === card.columnId)?.name ?? ''
      }))
    )
    setData({ project: target, files: filesRes.ok ? filesRes.files : [], sessions, cards })
    setLoading(false)
  }

  useEffect(() => {
    let lastShiftAt = 0
    const onKeyDown = (e: KeyboardEvent): void => {
      if (openRef.current) return
      if (e.key === 'Shift' && !e.repeat && !e.ctrlKey && !e.altKey && !e.metaKey) {
        const now = performance.now()
        if (now - lastShiftAt <= DOUBLE_SHIFT_MS) {
          lastShiftAt = 0
          e.preventDefault()
          void openOverlay()
        } else {
          lastShiftAt = now
        }
      } else {
        lastShiftAt = 0
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const items = useMemo<ResultItem[]>(() => {
    if (data === null) return []
    const { project: p, files, sessions, cards } = data
    const q = query.trim()
    if (q === '') {
      const recent: { ts: number; item: ResultItem }[] = []
      for (const s of sessions) {
        recent.push({
          ts: s.lastActivityEpochMs,
          item: {
            key: `session:${s.id}`,
            kind: 'session',
            title: s.title,
            sub: formatDate(s.lastActivityEpochMs, lang),
            score: 0,
            positions: [],
            open: () => openSession(p, s)
          }
        })
      }
      for (const c of cards) {
        recent.push({
          ts: Date.parse(c.card.updatedAt),
          item: {
            key: `card:${c.boardId}:${c.card.id}`,
            kind: 'card',
            title: c.card.title,
            sub: `${c.boardName} · ${c.columnName}`,
            score: 0,
            positions: [],
            open: () => openCard(p, c)
          }
        })
      }
      recent.sort((a, b) => b.ts - a.ts)
      return recent.slice(0, MAX_RESULTS).map((r) => r.item)
    }
    const out: ResultItem[] = []
    for (const path of files) {
      const m = fuzzyMatch(q, path)
      if (m === null) continue
      const slash = path.lastIndexOf('/')
      const base = slash === -1 ? path : path.slice(slash + 1)
      const offset = path.length - base.length
      out.push({
        key: `file:${path}`,
        kind: 'file',
        title: base,
        sub: slash === -1 ? null : path.slice(0, slash),
        score: m.score,
        positions: m.positions.filter((pos) => pos >= offset).map((pos) => pos - offset),
        open: () => openFile(p, path)
      })
    }
    for (const s of sessions) {
      const m = fuzzyMatch(q, s.title)
      if (m === null) continue
      out.push({
        key: `session:${s.id}`,
        kind: 'session',
        title: s.title,
        sub: formatDate(s.lastActivityEpochMs, lang),
        score: m.score,
        positions: m.positions,
        open: () => openSession(p, s)
      })
    }
    for (const c of cards) {
      const m = fuzzyMatch(q, c.card.title)
      if (m === null) continue
      out.push({
        key: `card:${c.boardId}:${c.card.id}`,
        kind: 'card',
        title: c.card.title,
        sub: `${c.boardName} · ${c.columnName}`,
        score: m.score,
        positions: m.positions,
        open: () => openCard(p, c)
      })
    }
    out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    return out.slice(0, MAX_RESULTS)
  }, [data, query, lang])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setIndex((i) => Math.min(i + 1, items.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        items[index]?.open()
        close()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, items, index])

  useEffect(() => {
    setIndex(0)
  }, [query])

  useEffect(() => {
    listRef.current?.querySelector('.selected')?.scrollIntoView({ block: 'nearest' })
  }, [index, items])

  if (!open) return null
  const selected = Math.min(index, items.length - 1)
  return (
    <div
      className="files-rename-overlay search-everywhere-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close()
      }}
    >
      <div className="tab-switcher-box search-everywhere-box" onMouseDown={(e) => e.stopPropagation()}>
        <input
          className="search-everywhere-input"
          autoFocus
          value={query}
          placeholder={t('Search everywhere…')}
          onChange={(e) => setQuery(e.target.value)}
        />
        {loading ? (
          <div className="search-everywhere-empty">{t('loading…')}</div>
        ) : items.length === 0 ? (
          <div className="search-everywhere-empty">{t('No results')}</div>
        ) : (
          <div className="search-everywhere-list" ref={listRef}>
            {items.map((item, i) => (
              <div
                key={item.key}
                className={`search-everywhere-item${i === selected ? ' selected' : ''}`}
                onMouseMove={() => setIndex(i)}
                onClick={() => {
                  item.open()
                  close()
                }}
              >
                <span className="search-everywhere-icon">{itemIcon(item.kind)}</span>
                <span className="search-everywhere-title">
                  <Highlight text={item.title} positions={item.positions} />
                </span>
                {item.sub !== null && <span className="search-everywhere-sub">{item.sub}</span>}
              </div>
            ))}
          </div>
        )}
        <div className="search-everywhere-hint">{t('↑↓ navigate, Enter open, Esc close')}</div>
      </div>
    </div>
  )
}
