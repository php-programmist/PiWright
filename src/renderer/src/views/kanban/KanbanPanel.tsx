import { useEffect, useRef, useState } from 'react'
import { parentTabKey, useCenterProject, useTabsStore } from '../../stores/tabs'
import { useKanbanStore } from '../../stores/kanban'
import { projectKey } from '../../stores/sessions'
import { useT } from '../../lib/i18n'
import { persistPanel } from '../../stores/panels-prefs'
import { confirmDialog } from '../../components/ConfirmDialog'
import { kanbanThemeAccent } from '../../../../shared/kanban-theme'
import type { KanbanBoard, KanbanCard, KanbanColumn } from '../../../../shared/kanban'
import type { KanbanBoardSummary, ProjectEntry } from '../../../../shared/ipc-contracts'
import { BADGE_CLASS, DOT_LABEL, cardDotOf, useCardDotInputs, type CardDotInputs } from '../../lib/kanban-card-dot'
import { CardDot } from './CardDot'
import {
  setColumnsCollapsed,
  toggleBoardExpanded,
  toggleColumnCollapsed,
  useBoardExpanded,
  useBoardTheme,
  useColumnCollapsed,
} from '../../lib/kanban-tree-prefs'

/** Кружки свёрнутой колонки: сколько задач каждого цвета ждут внимания (как бейджи у проектов). */
function countCardDots(cards: KanbanCard[], boardId: string, inputs: CardDotInputs): { cls: string; label: string; count: number }[] {
  const groups = new Map<string, { cls: string; label: string; count: number }>()
  for (const card of cards) {
    const hit = cardDotOf(card, boardId, inputs)
    if (hit === null) continue
    const existing = groups.get(hit.dot)
    if (existing === undefined) groups.set(hit.dot, { cls: BADGE_CLASS[hit.dot], label: DOT_LABEL[hit.dot], count: 1 })
    else existing.count += 1
  }
  return [...groups.values()]
}

/** Колонка первым уровнем дерева + её задачи вторым; сворачивается своим шевроном. */
function ColumnRow({
  project,
  boardId,
  column,
  index,
  cards,
  onOpenCard,
}: {
  project: ProjectEntry
  boardId: string
  column: KanbanColumn
  index: number
  cards: KanbanCard[]
  onOpenCard: (cardId: string) => void
}): React.JSX.Element {
  const t = useT()
  const theme = useBoardTheme()
  const collapsed = useColumnCollapsed(project, boardId, column.id)
  const inputs = useCardDotInputs(project)
  const accent = theme === null ? undefined : kanbanThemeAccent(theme, index)
  const dots = collapsed ? countCardDots(cards, boardId, inputs) : null
  return (
    <div className="kanban-tree-group">
      <div className="kanban-tree-col">
        <button
          className="expand"
          title={collapsed ? t('Expand column') : t('Collapse column')}
          onClick={() => toggleColumnCollapsed(project, boardId, column.id)}
        >
          {collapsed ? '▸' : '▾'}
        </button>
        <span className="kanban-col-accent" style={accent === undefined ? undefined : { background: accent }} />
        <span className="kanban-tree-col-name" title={column.name}>
          {column.name}
        </span>
        {collapsed &&
          dots?.map((badge) => (
            <span key={badge.cls} className={`proj-badge ${badge.cls}`} title={t(badge.label)}>
              {badge.count}
            </span>
          ))}
        <span className="kanban-board-count">{cards.length}</span>
      </div>
      {!collapsed &&
        cards.map((card) => (
          <div key={card.id} className="kanban-tree-card" title={card.title} onClick={() => onOpenCard(card.id)}>
            <CardDot card={card} boardId={boardId} inputs={inputs} />
            <span className="kanban-tree-card-title">{card.title}</span>
          </div>
        ))}
    </div>
  )
}

/** Дерево задач раскрытой доски. */
function BoardTree({
  project,
  boardId,
  rev,
  onOpenCard,
}: {
  project: ProjectEntry
  boardId: string
  rev: number
  onOpenCard: (cardId: string) => void
}): React.JSX.Element {
  const [data, setData] = useState<KanbanBoard | null>(null)
  useEffect(() => {
    let cancelled = false
    void window.piwright.kanbanBoardGet(project, boardId).then((result) => {
      if (cancelled || !result.ok) return
      setData(result.board)
    })
    return () => {
      cancelled = true
    }
  }, [project, boardId, rev])
  if (data === null) return <div className="panel-hint">…</div>
  return (
    <div className="kanban-tree">
      {data.columns.map((column, index) => (
        <ColumnRow
          key={column.id}
          project={project}
          boardId={data.id}
          column={column}
          index={index}
          cards={data.cards.filter((card) => card.columnId === column.id).sort((a, b) => a.order - b.order)}
          onOpenCard={onOpenCard}
        />
      ))}
    </div>
  )
}

function BoardRow({
  project,
  board,
  renaming,
  renameText,
  onRenameText,
  onStartRename,
  onSubmitRename,
  onCancelRename,
  menuOpen,
  onToggleMenu,
  menuRef,
}: {
  project: ProjectEntry
  board: KanbanBoardSummary
  renaming: boolean
  renameText: string
  onRenameText: (text: string) => void
  onStartRename: () => void
  onSubmitRename: (name: string) => void
  onCancelRename: () => void
  menuOpen: boolean
  onToggleMenu: () => void
  menuRef: React.Ref<HTMLSpanElement>
}): React.JSX.Element {
  const t = useT()
  const expanded = useBoardExpanded(project, board.id)

  const collapseAll = async (collapsed: boolean): Promise<void> => {
    onToggleMenu()
    const result = await window.piwright.kanbanBoardGet(project, board.id)
    if (!result.ok || result.board === null) return
    setColumnsCollapsed(project, board.id, result.board.columns.map((column) => column.id), collapsed)
  }

  const deleteBoard = async (): Promise<void> => {
    onToggleMenu()
    const ok = await confirmDialog({ message: t('Delete board "{name}"?', { name: board.name }), confirmLabel: t('Delete'), danger: true })
    if (!ok) return
    void useKanbanStore.getState().remove(project, board.id)
  }

  const openCard = (cardId: string): void => {
    const tabs = useTabsStore.getState()
    tabs.setActiveProject(parentTabKey(project))
    tabs.openTab(project, { kind: 'kanban', boardId: board.id, title: board.name })
    useKanbanStore.getState().setOpenCard(`${projectKey(project)}\u0000${board.id}`, cardId)
  }

  if (renaming) {
    return (
      <input
        className="kanban-name-input"
        autoFocus
        value={renameText}
        onChange={(e) => onRenameText(e.target.value)}
        onBlur={() => onSubmitRename(renameText)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmitRename(renameText)
          if (e.key === 'Escape') onCancelRename()
        }}
      />
    )
  }

  return (
    <div className="kanban-tree-board">
      <div className="kanban-board-row">
        <button className="expand" title={t('Tasks tree')} onClick={() => toggleBoardExpanded(project, board.id)}>
          {expanded ? '▾' : '▸'}
        </button>
        <button
          className="kanban-board-name"
          title={t('Open board')}
          onClick={() => useTabsStore.getState().openTab(project, { kind: 'kanban', boardId: board.id, title: board.name })}
        >
          {board.name}
        </button>
        <span className="kanban-board-count">{board.cards}</span>
        <span className="menu-wrap" ref={menuOpen ? menuRef : undefined}>
          <button className="kanban-board-action" title={t('Board menu')} onClick={onToggleMenu}>
            ⋯
          </button>
          {menuOpen && (
            <div className="project-menu">
              <button className="project-menu-item" onClick={onStartRename}>
                <span className="kanban-menu-glyph">✎</span>
                {t('Rename')}
              </button>
              <button className="project-menu-item" onClick={() => void collapseAll(true)}>
                <span className="kanban-menu-glyph">⊟</span>
                {t('Collapse all columns')}
              </button>
              <button className="project-menu-item" onClick={() => void collapseAll(false)}>
                <span className="kanban-menu-glyph">⊞</span>
                {t('Expand all columns')}
              </button>
              <div className="project-menu-sep" />
              <button className="project-menu-item danger" onClick={() => void deleteBoard()}>
                <span className="kanban-menu-glyph">✕</span>
                {t('Delete board')}
              </button>
            </div>
          )}
        </span>
      </div>
      {expanded && <BoardTree project={project} boardId={board.id} rev={board.rev} onOpenCard={openCard} />}
    </div>
  )
}

/** Панель досок канбана (правый рельс): список досок проекта, добавить, меню «...»
 *  (переименовать / свернуть все / удалить) и раскрытие дерева задач. */
export function KanbanPanel(): React.JSX.Element {
  const project = useCenterProject()
  const width = useKanbanStore((s) => s.width)
  const boards = useKanbanStore((s) => s.boards)
  const loading = useKanbanStore((s) => s.loading)
  const error = useKanbanStore((s) => s.error)
  const t = useT()
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const [menuBoardId, setMenuBoardId] = useState<string | null>(null)
  const menuRef = useRef<HTMLSpanElement | null>(null)

  useEffect(() => {
    useKanbanStore.getState().setProject(project)
  }, [project])

  // Агент мутирует доску через pi-расширение напрямую (мимо renderer) — summary и дерево
  // задачи свежие только поллингом; rev в summary перезапускает загрузку дерева.
  useEffect(() => {
    if (project === null) return
    const timer = window.setInterval(() => {
      void useKanbanStore.getState().refresh(project)
    }, 3000)
    return () => window.clearInterval(timer)
  }, [project])

  useEffect(() => {
    if (menuBoardId === null) return
    const onDown = (e: MouseEvent): void => {
      if (menuRef.current !== null && !menuRef.current.contains(e.target as HTMLElement)) setMenuBoardId(null)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMenuBoardId(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuBoardId])

  const startResize = (down: React.MouseEvent): void => {
    down.preventDefault()
    const move = (e: MouseEvent): void => useKanbanStore.getState().setWidth(window.innerWidth - e.clientX)
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      persistPanel('kanban', { width: useKanbanStore.getState().width })
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const submitCreate = (): void => {
    const name = newName.trim()
    setAdding(false)
    setNewName('')
    if (name.length === 0 || project === null) return
    void useKanbanStore.getState().create(project, name)
  }

  const submitRename = (name: string): void => {
    const id = renamingId
    setRenamingId(null)
    setRenameText('')
    if (name.trim().length === 0 || id === null || project === null) return
    void useKanbanStore.getState().rename(project, id, name.trim())
  }

  return (
    <aside className="kanban-panel" style={{ width }}>
      <div className="git-resizer" onMouseDown={startResize} />
      <div className="git-head">
        <span>{t('Kanban')}</span>
        <span className="spacer" />
        <button
          className="kanban-add"
          title={t('New board')}
          onClick={() => {
            setAdding(true)
            setNewName('')
          }}
        >
          +
        </button>
        <button
          className="icon"
          title={t('Collapse panel')}
          onClick={() => {
            useKanbanStore.getState().toggleOpen()
            persistPanel('kanban', { open: false })
          }}
        >
          −
        </button>
      </div>
      <div className="kanban-body">
        {adding && (
          <input
            className="kanban-name-input"
            autoFocus
            placeholder={t('Board name')}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={submitCreate}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitCreate()
              if (e.key === 'Escape') setAdding(false)
            }}
          />
        )}
        {error !== null && (
          <div className="git-error">
            <span>{error}</span>
          </div>
        )}
        {loading && boards.length === 0 ? (
          <div className="panel-hint">…</div>
        ) : boards.length === 0 ? (
          <div className="panel-hint">{t('No boards yet')}</div>
        ) : (
          boards.map((board) =>
            project === null ? null : (
              <BoardRow
                key={board.id}
                project={project}
                board={board}
                renaming={renamingId === board.id}
                renameText={renamingId === board.id ? renameText : ''}
                onStartRename={() => {
                  setMenuBoardId(null)
                  setRenamingId(board.id)
                  setRenameText(board.name)
                }}
                onRenameText={setRenameText}
                onSubmitRename={submitRename}
                onCancelRename={() => {
                  setRenamingId(null)
                  setRenameText('')
                }}
                menuOpen={menuBoardId === board.id}
                onToggleMenu={() => setMenuBoardId((current) => (current === board.id ? null : board.id))}
                menuRef={menuRef}
              />
            ),
          )
        )}
      </div>
    </aside>
  )
}
