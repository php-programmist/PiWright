import { useCallback, useEffect, useRef, useState } from 'react'
import { applyCardMove } from '../../../../shared/kanban'
import type { KanbanBoard, KanbanCard, KanbanColumn, KanbanCommitRef, KanbanSessionRef } from '../../../../shared/kanban'
import type { KanbanMutationResult, ProjectEntry, SessionSummary } from '../../../../shared/ipc-contracts'
import { base64FromBytes } from '../../../../shared/attachments'
import { draftMap, loopExitMap, useChatStore } from '../../stores/chat'
import { useSessionsStore, projectKey } from '../../stores/sessions'
import { parentTabKey, useTabsStore } from '../../stores/tabs'
import { useGitLogStore } from '../../stores/gitlog'
import { useKanbanStore } from '../../stores/kanban'
import { useTerminalStore } from '../../stores/terminal'
import { persistPanel } from '../../stores/panels-prefs'
import type { ProjectTab } from '../../stores/tabs'
import { useLang, useT } from '../../lib/i18n'
import { kanbanColumnStyle } from '../../lib/appearance'
import { useKanbanThemeStore } from '../../stores/kanban-theme'
import { resolveKanbanTheme } from '../../../../shared/kanban-theme'
import type { KanbanTheme } from '../../../../shared/kanban-theme'
import { confirmDialog } from '../../components/ConfirmDialog'
import { Lightbox } from '../../components/Lightbox'

interface DropTarget {
  columnId: string
  index: number
}

/** dataUrl превью по пути вложения — кэш на модуль, чтобы не перечитывать файл. */
const thumbCache = new Map<string, string>()

function KanbanThumb({ project, path, onOpen }: { project: ProjectEntry; path: string; onOpen: (src: string) => void }): React.JSX.Element {
  const [src, setSrc] = useState(() => thumbCache.get(path) ?? '')
  useEffect(() => {
    if (src !== '') return
    let cancelled = false
    void window.piwright.kanbanAttachmentGet(project, path).then((res) => {
      if (cancelled || !res.ok || res.dataUrl === '') return
      thumbCache.set(path, res.dataUrl)
      setSrc(res.dataUrl)
    })
    return () => {
      cancelled = true
    }
  }, [project, path, src])
  if (src === '') return <div className="board-thumb loading" />
  return <img className="board-thumb" src={src} alt={path} onClick={() => onOpen(src)} />
}

/** Чип сессии в комментарии: живая — активация чата, из истории — восстановление чата,
 *  нигде не найдена — приглушённый чип с тултипом. */
function SessionChip({ project, session }: { project: ProjectEntry; session: KanbanSessionRef }): React.JSX.Element {
  const t = useT()
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    const st = useSessionsStore.getState()
    if (st.active.some((r) => r.sessionId === session.id)) return
    if (st.projects.some((p) => p.history.some((h) => h.id === session.id))) return
    let cancelled = false
    void window.piwright.sessionHistory(project).then((history) => {
      if (!cancelled && !history.some((h) => h.id === session.id)) setMissing(true)
    })
    return () => {
      cancelled = true
    }
  }, [project, session.id])

  const open = (): void => {
    const st = useSessionsStore.getState()
    const row = st.active.find((r) => r.sessionId === session.id)
    if (row !== undefined) {
      useTabsStore.getState().setActiveProject(parentTabKey(row.project))
      useTabsStore.getState().activateSession(row.project)
      st.setActive(row.hostId)
      return
    }
    const resume = async (found: SessionSummary): Promise<void> => {
      const result = await window.piwright.openSession(project, found.path)
      if (!result.ok) {
        if (result.error !== null) window.alert(result.error)
        return
      }
      useTabsStore.getState().setActiveProject(parentTabKey(project))
      useTabsStore.getState().activateSession(project)
      st.setActive(result.hostId)
    }
    const summary = st.projects
      .find((p) => p.history.some((h) => h.id === session.id))
      ?.history.find((h) => h.id === session.id)
    if (summary !== undefined) {
      void resume(summary)
      return
    }
    void window.piwright.sessionHistory(project).then((history) => {
      const found = history.find((h) => h.id === session.id)
      if (found !== undefined) void resume(found)
    })
  }

  return (
    <span
      className={missing ? 'board-chip missing' : 'board-chip session'}
      title={missing ? t('Session not found') : session.title}
      onClick={open}
    >
      {session.title}
    </span>
  )
}

/** Чип коммита: первый клик — док «История Git» + выделение коммита, повторный —
 *  дифф первого файла коммита во вкладке. */
function CommitChip({ project, commit }: { project: ProjectEntry; commit: KanbanCommitRef }): React.JSX.Element {
  const open = (): void => {
    const gl = useGitLogStore.getState()
    if (!gl.open) {
      if (useTerminalStore.getState().open) {
        useTerminalStore.getState().toggleOpen()
        persistPanel('terminal', { open: false })
      }
      gl.toggleOpen()
      persistPanel('gitlog', { open: true })
    }
    gl.setProject(project)
    void gl.refresh(project)
    if (gl.selectedHash === commit.hash) {
      const file = gl.files[0]
      if (file !== undefined) useTabsStore.getState().openTab(project, { kind: 'diff', path: file.path, hash: commit.hash })
    } else {
      void gl.select(project, commit.hash)
    }
  }
  return (
    <span className="board-chip commit" title={commit.message} onClick={open}>
      {commit.hash.slice(0, 7)}
    </span>
  )
}

/** Тема досок из настроек (null — канбан выключен, цвета системные). */
function useBoardTheme(): KanbanTheme | null {
  const settings = useSessionsStore((s) => s.settings)
  const custom = useKanbanThemeStore((s) => s.custom)
  if (settings === null || !settings.kanbanEnabled) return null
  return resolveKanbanTheme(custom, settings.kanbanTheme)
}

/** Вкладка-доска: колонки в ряд, DnD карточек (между колонками и внутри), CRUD колонок,
 *  модалка карточки (описание, комментарии, удаление). */
export function BoardView({ tab }: { tab: ProjectTab }): React.JSX.Element {
  const t = useT()
  const boardTheme = useBoardTheme()
  const [board, setBoard] = useState<KanbanBoard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [workflowOpen, setWorkflowOpen] = useState(false)
  const [dragCardId, setDragCardId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null)
  const dragCardRef = useRef<string | null>(null)
  const dropTargetRef = useRef<DropTarget | null>(null)

  const setDragCard = (id: string | null): void => {
    dragCardRef.current = id
    setDragCardId(id)
  }

  const setDrop = (target: DropTarget | null): void => {
    dropTargetRef.current = target
    setDropTarget(target)
  }
  const [addingColumn, setAddingColumn] = useState(false)
  const [newColumnName, setNewColumnName] = useState('')
  const [renamingColumnId, setRenamingColumnId] = useState<string | null>(null)
  const [columnRenameText, setColumnRenameText] = useState('')
  const [addingCardColumnId, setAddingCardColumnId] = useState<string | null>(null)
  const [newCardTitle, setNewCardTitle] = useState('')
  const loopsEnabled = useSessionsStore((s) => s.settings?.loopsEnabled ?? false)
  const [columnMenu, setColumnMenu] = useState<{ columnId: string; x: number; y: number } | null>(null)
  const columnMenuRef = useRef<HTMLDivElement | null>(null)
  const [moveCardsFrom, setMoveCardsFrom] = useState<string | null>(null)
  const [moveCardsTarget, setMoveCardsTarget] = useState('')
  const [cardMenu, setCardMenu] = useState<{ cardId: string; x: number; y: number } | null>(null)
  const cardMenuRef = useRef<HTMLDivElement | null>(null)
  const boardId = tab.boardId
  // Открытая карточка живёт в сторе: смена вкладки размонтирует BoardView, при возврате модалка восстанавливается.
  const boardKey = `${projectKey(tab.project)}\u0000${boardId ?? ''}`
  const modalCardId = useKanbanStore((s) => s.openCard[boardKey] ?? null)
  const setModalCardId = useCallback(
    (cardId: string | null): void => {
      useKanbanStore.getState().setOpenCard(boardKey, cardId)
    },
    [boardKey],
  )

  useEffect(() => {
    let cancelled = false
    void window.piwright.kanbanBoardGet(tab.project, boardId ?? '').then((result) => {
      if (cancelled) return
      if (!result.ok) setError(result.error)
      else setBoard(result.board)
    })
    return () => {
      cancelled = true
    }
  }, [tab.project, boardId])

  useEffect(() => {
    if (columnMenu === null) return
    const onDown = (e: MouseEvent): void => {
      const target = e.target as HTMLElement
      if (columnMenuRef.current !== null && !columnMenuRef.current.contains(target) && target.closest('.board-column-head .board-column-btn') === null) {
        setColumnMenu(null)
      }
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setColumnMenu(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [columnMenu])

  useEffect(() => {
    if (cardMenu === null) return
    const onDown = (e: MouseEvent): void => {
      const target = e.target as HTMLElement
      if (cardMenuRef.current !== null && !cardMenuRef.current.contains(target) && target.closest('.board-card-btn') === null) {
        setCardMenu(null)
      }
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setCardMenu(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [cardMenu])

  useEffect(() => {
    if (moveCardsFrom === null) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setMoveCardsFrom(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [moveCardsFrom])

  const reload = (): void => {
    void window.piwright.kanbanBoardGet(tab.project, boardId ?? '').then((result) => {
      if (result.ok) setBoard(result.board)
    })
  }

  const apply = (result: KanbanMutationResult): void => {
    if (!result.ok) {
      setError(result.error)
      reload()
      return
    }
    if (result.board !== null) setBoard(result.board)
  }

  if (error !== null) return <div className="board-view"><div className="panel-hint">{error}</div></div>
  if (board === null) return <div className="board-view"><div className="panel-hint">{t('Board not found')}</div></div>

  const cardById = (id: string): KanbanCard | undefined => board.cards.find((card) => card.id === id)

  const cardDragStart = (e: React.DragEvent, card: KanbanCard): void => {
    e.dataTransfer.setData('text/plain', card.id)
    e.dataTransfer.effectAllowed = 'move'
    setDragCardId(card.id)
  }

  const cardDragEnd = (): void => {
    setDragCard(null)
    setDrop(null)
  }

  const columnDragOver = (e: React.DragEvent, columnId: string): void => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const els = Array.from((e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[data-card-id]'))
    let index = els.length
    for (let i = 0; i < els.length; i += 1) {
      const rect = els[i].getBoundingClientRect()
      if (e.clientY < rect.top + rect.height / 2) {
        index = i
        break
      }
    }
    setDrop({ columnId, index })
  }

  const columnDragLeave = (e: React.DragEvent, columnId: string): void => {
    if (dropTargetRef.current?.columnId !== columnId) return
    const container = e.currentTarget as HTMLElement
    if (e.relatedTarget instanceof Node && container.contains(e.relatedTarget)) return
    setDrop(null)
  }

  /** Индекс среди карточек колонки без перетаскиваемой (семантика applyCardMove). */
  const dropIndex = (columnId: string, index: number): number => {
    const draggedId = dragCardRef.current
    const dragged = draggedId === null ? undefined : cardById(draggedId)
    if (dragged === undefined || dragged.columnId !== columnId) return index
    const inColumn = board.cards.filter((card) => card.columnId === columnId).sort((a, b) => a.order - b.order)
    const position = inColumn.findIndex((card) => card.id === dragged.id)
    return index <= position ? index : index - 1
  }

  const columnDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    const id = dragCardRef.current ?? e.dataTransfer.getData('text/plain')
    const target = dropTargetRef.current
    setDragCard(null)
    setDrop(null)
    if (id.length === 0 || target === null) return
    const index = dropIndex(target.columnId, target.index)
    setBoard(applyCardMove(board, { id, columnId: target.columnId, index }))
    void window.piwright.kanbanCardMove(tab.project, boardId ?? '', { id, columnId: target.columnId, index }).then(apply)
  }

  const moveColumn = (columnId: string, index: number): void => {
    void window.piwright.kanbanColumnMove(tab.project, boardId ?? '', columnId, index).then(apply)
  }

  const startColumnRename = (columnId: string, name: string): void => {
    setRenamingColumnId(columnId)
    setColumnRenameText(name)
  }

  const submitColumnRename = (): void => {
    const id = renamingColumnId
    const name = columnRenameText.trim()
    setRenamingColumnId(null)
    setColumnRenameText('')
    if (id === null || name.length === 0) return
    void window.piwright.kanbanColumnRename(tab.project, boardId ?? '', id, name).then(apply)
  }

  const deleteColumn = async (columnId: string, name: string): Promise<void> => {
    const ok = await confirmDialog({
      message: t('Delete column "{name}"? Cards move to Backlog.', { name }),
      confirmLabel: t('Delete'),
      danger: true,
    })
    if (!ok) return
    void window.piwright.kanbanColumnDelete(tab.project, boardId ?? '', columnId).then(apply)
  }

  const clearColumn = async (columnId: string, name: string): Promise<void> => {
    const count = board.cards.filter((card) => card.columnId === columnId).length
    const ok = await confirmDialog({
      message: t('Clear column "{name}"? {count} tasks will be deleted.', { name, count }),
      confirmLabel: t('Clear'),
      danger: true,
    })
    if (!ok) return
    apply(await window.piwright.kanbanColumnClear(tab.project, board.id, columnId))
  }

  const openMoveCards = (columnId: string): void => {
    const firstOther = board.columns.find((column) => column.id !== columnId)
    setMoveCardsTarget(firstOther === undefined ? '' : firstOther.id)
    setMoveCardsFrom(columnId)
  }

  const submitMoveCards = (): void => {
    const from = moveCardsFrom
    setMoveCardsFrom(null)
    if (from === null || moveCardsTarget.length === 0) return
    void window.piwright.kanbanColumnCardsMove(tab.project, board.id, { id: from, targetColumnId: moveCardsTarget }).then(apply)
  }

  const submitNewColumn = (): void => {
    const name = newColumnName.trim()
    setAddingColumn(false)
    setNewColumnName('')
    if (name.length === 0) return
    void window.piwright.kanbanColumnCreate(tab.project, boardId ?? '', name).then(apply)
  }

  const submitNewCard = (columnId: string): void => {
    const title = newCardTitle.trim()
    setAddingCardColumnId(null)
    setNewCardTitle('')
    if (title.length === 0) return
    void window.piwright.kanbanCardCreate(tab.project, boardId ?? '', { title, columnId }).then(apply)
  }

  const openColumnMenu = (columnId: string, x: number, y: number): void => {
    setColumnMenu({ columnId, x: Math.min(x, window.innerWidth - 210), y: Math.min(y, window.innerHeight - 400) })
  }

  const openCardMenu = (cardId: string, x: number, y: number): void => {
    setCardMenu({ cardId, x: Math.min(x, window.innerWidth - 210), y: Math.min(y, window.innerHeight - 320) })
  }

  const moveCardToEdge = (card: KanbanCard, index: number | undefined): void => {
    setCardMenu(null)
    setBoard(applyCardMove(board, { id: card.id, columnId: card.columnId, index }))
    void window.piwright.kanbanCardMove(tab.project, boardId ?? '', { id: card.id, columnId: card.columnId, index }).then(apply)
  }

  const deleteCard = async (card: KanbanCard): Promise<void> => {
    const ok = await confirmDialog({
      message: t('Delete card "{title}"?', { title: card.title }),
      confirmLabel: t('Delete'),
      danger: true,
    })
    if (!ok) return
    apply(await window.piwright.kanbanCardDelete(tab.project, board.id, card.id))
  }

  const startCardSession = async (card: KanbanCard): Promise<void> => {
    setCardMenu(null)
    const boards = await window.piwright.kanbanBoards(tab.project)
    const multiBoard = boards.ok && boards.boards.length > 1
    const ref = await window.piwright.newSession(tab.project)
    draftMap.set(
      ref.hostId,
      multiBoard
        ? t('Kanban. Take the task with ID {id} on the {board} board and complete it', { id: card.id, board: board.name })
        : t('Kanban. Take the task with ID {id} and complete it', { id: card.id }),
    )
    useTabsStore.getState().setActiveProject(parentTabKey(tab.project))
    useTabsStore.getState().activateSession(tab.project)
    useSessionsStore.getState().setActive(ref.hostId)
  }

  const startLoopSession = async (column: KanbanColumn, mode: 'while' | 'count'): Promise<void> => {
    setColumnMenu(null)
    const boards = await window.piwright.kanbanBoards(tab.project)
    const multiBoard = boards.ok && boards.boards.length > 1
    const ref = await window.piwright.newSession(tab.project)
    const chatStore = useChatStore.getState()
    chatStore.setLoopEnabled(ref.hostId, true)
    if (mode === 'while') {
      loopExitMap.set(ref.hostId, t('The kanban column {name} has no tasks', { name: column.name }))
    } else {
      const count = board.cards.filter((card) => card.columnId === column.id).length
      chatStore.setLoopMax(ref.hostId, Math.max(1, count))
    }
    draftMap.set(
      ref.hostId,
      multiBoard
        ? t('Kanban. Take a task from the {name} column on the {board} board and complete it', { name: column.name, board: board.name })
        : t('Kanban. Take a task from the {name} column and complete it', { name: column.name }),
    )
    useTabsStore.getState().setActiveProject(parentTabKey(tab.project))
    useTabsStore.getState().activateSession(tab.project)
    useSessionsStore.getState().setActive(ref.hostId)
  }

  const renderCards = (columnId: string, cards: KanbanCard[]): React.JSX.Element[] => {
    const items: React.JSX.Element[] = []
    const showLine = dragCardId !== null && dropTarget?.columnId === columnId
    cards.forEach((card, i) => {
      if (showLine && dropTarget.index === i) items.push(<div key="drop-line" className="board-drop-line" />)
      items.push(
        <div
          key={card.id}
          data-card-id={card.id}
          className={dragCardId === card.id ? 'board-card dragging' : 'board-card'}
          draggable
          onDragStart={(e) => cardDragStart(e, card)}
          onDragEnd={cardDragEnd}
          onDoubleClick={() => setModalCardId(card.id)}
          onContextMenu={(e) => {
            e.preventDefault()
            openCardMenu(card.id, e.clientX, e.clientY)
          }}
        >
          <button
            className="board-card-btn"
            title={t('Card menu')}
            onMouseDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onClick={(e) => {
              if (cardMenu?.cardId === card.id) {
                setCardMenu(null)
                return
              }
              const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
              openCardMenu(card.id, rect.right, rect.bottom + 2)
            }}
          >
            ⋯
          </button>
          <div className="board-card-title">{card.title}</div>
          {(card.comments.length > 0 || card.images.length > 0) && (
            <div className="board-card-badges">
              {card.comments.length > 0 && <span className="board-badge" title={t('Comments')}>💬 {card.comments.length}</span>}
              {card.images.length > 0 && <span className="board-badge" title={t('Images')}>🖼 {card.images.length}</span>}
            </div>
          )}
        </div>,
      )
    })
    if (showLine && dropTarget.index >= cards.length) items.push(<div key="drop-line" className="board-drop-line" />)
    return items
  }

  return (
    <div className="board-view">
      <div className="board-head">
        <span className="board-title">{board.name}</span>
        <span className="board-rev">rev {board.rev}</span>
        <button className="board-column-btn board-head-refresh" title={t('Refresh')} onClick={reload}>↻</button>
        <button className="board-column-btn board-head-workflow" title={t('Edit workflow')} onClick={() => setWorkflowOpen(true)}>⚙</button>
        <button
          className="board-column-btn board-head-add"
          title={t('Add column')}
          onClick={() => {
            setAddingColumn(true)
            setNewColumnName('')
          }}
        >
          +
        </button>
      </div>
      <div className="board-columns">
        {board.columns.map((column, index) => {
          const cards = board.cards.filter((card) => card.columnId === column.id).sort((a, b) => a.order - b.order)
          return (
            <div
              key={column.id}
              className="board-column"
              style={kanbanColumnStyle(boardTheme, index)}
              onDragOver={(e) => columnDragOver(e, column.id)}
              onDragLeave={(e) => columnDragLeave(e, column.id)}
              onDrop={columnDrop}
            >
              <div
                className="board-column-head"
                onContextMenu={(e) => {
                  e.preventDefault()
                  openColumnMenu(column.id, e.clientX, e.clientY)
                }}
              >
                {renamingColumnId === column.id ? (
                  <input
                    className="kanban-name-input"
                    autoFocus
                    value={columnRenameText}
                    onChange={(e) => setColumnRenameText(e.target.value)}
                    onBlur={submitColumnRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitColumnRename()
                      if (e.key === 'Escape') setRenamingColumnId(null)
                    }}
                  />
                ) : (
                  <>
                    <span
                      className="board-column-name"
                      title={t('Rename column')}
                      onDoubleClick={() => startColumnRename(column.id, column.name)}
                    >
                      {column.name}
                    </span>
                    <span className="board-column-count">{cards.length}</span>
                    <button
                      className="board-column-btn"
                      title={t('Column menu')}
                      onClick={(e) => {
                        if (columnMenu?.columnId === column.id) {
                          setColumnMenu(null)
                          return
                        }
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                        openColumnMenu(column.id, rect.left, rect.bottom + 2)
                      }}
                    >
                      ⋯
                    </button>
                  </>
                )}
              </div>
              <div className="board-column-cards">
                {renderCards(column.id, cards)}
                {addingCardColumnId === column.id ? (
                  <input
                    className="kanban-name-input"
                    autoFocus
                    placeholder={t('Card title')}
                    value={newCardTitle}
                    onChange={(e) => setNewCardTitle(e.target.value)}
                    onBlur={() => submitNewCard(column.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') submitNewCard(column.id)
                      if (e.key === 'Escape') setAddingCardColumnId(null)
                    }}
                  />
                ) : (
                  <button
                    className="board-card-add"
                    onClick={() => {
                      setAddingCardColumnId(column.id)
                      setNewCardTitle('')
                    }}
                  >
                    + {t('Add card')}
                  </button>
                )}
              </div>
            </div>
          )
        })}
        {addingColumn && (
          <div className="board-column board-add-column">
            <input
              className="kanban-name-input"
              autoFocus
              placeholder={t('Column name')}
              value={newColumnName}
              onChange={(e) => setNewColumnName(e.target.value)}
              onBlur={submitNewColumn}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitNewColumn()
                if (e.key === 'Escape') setAddingColumn(false)
              }}
            />
          </div>
        )}
      </div>
      {columnMenu !== null &&
        (() => {
          const column = board.columns.find((item) => item.id === columnMenu.columnId)
          if (column === undefined) return null
          const columnIndex = board.columns.indexOf(column)
          return (
            <div className="files-menu" style={{ left: columnMenu.x, top: columnMenu.y }} ref={columnMenuRef}>
              <button
                className="project-menu-item"
                onClick={() => {
                  setColumnMenu(null)
                  setAddingCardColumnId(column.id)
                  setNewCardTitle('')
                }}
              >
                {t('Add task')}
              </button>
              {loopsEnabled && (
                <>
                  <button className="project-menu-item" onClick={() => void startLoopSession(column, 'while')}>
                    {t('Loop: while there are tasks')}
                  </button>
                  <button className="project-menu-item" onClick={() => void startLoopSession(column, 'count')}>
                    {t('Loop: exact count')}
                  </button>
                </>
              )}
              <div className="project-menu-sep" />
              <button
                className="project-menu-item"
                onClick={() => {
                  setColumnMenu(null)
                  startColumnRename(column.id, column.name)
                }}
              >
                {t('Rename')}
              </button>
              <button
                className="project-menu-item"
                disabled={columnIndex === 0}
                onClick={() => {
                  setColumnMenu(null)
                  moveColumn(column.id, columnIndex - 1)
                }}
              >
                {t('Move left')}
              </button>
              <button
                className="project-menu-item"
                disabled={columnIndex === board.columns.length - 1}
                onClick={() => {
                  setColumnMenu(null)
                  moveColumn(column.id, columnIndex + 1)
                }}
              >
                {t('Move right')}
              </button>
              <button
                className="project-menu-item"
                disabled={board.columns.length < 2}
                onClick={() => {
                  setColumnMenu(null)
                  openMoveCards(column.id)
                }}
              >
                {t('Move tasks to...')}
              </button>
              <div className="project-menu-sep" />
              <button
                className="project-menu-item danger"
                onClick={() => {
                  setColumnMenu(null)
                  void clearColumn(column.id, column.name)
                }}
              >
                {t('Clear column')}
              </button>
              <div className="project-menu-sep" />
              <button
                className="project-menu-item danger"
                onClick={() => {
                  setColumnMenu(null)
                  void deleteColumn(column.id, column.name)
                }}
              >
                {t('Delete')}
              </button>
            </div>
          )
        })()}
      {cardMenu !== null &&
        (() => {
          const card = cardById(cardMenu.cardId)
          if (card === undefined) return null
          const inColumn = board.cards.filter((item) => item.columnId === card.columnId).sort((a, b) => a.order - b.order)
          const position = inColumn.findIndex((item) => item.id === card.id)
          return (
            <div className="files-menu" style={{ left: cardMenu.x, top: cardMenu.y }} ref={cardMenuRef}>
              <button
                className="project-menu-item"
                onClick={() => {
                  setCardMenu(null)
                  setModalCardId(card.id)
                }}
              >
                {t('Edit')}
              </button>
              <button className="project-menu-item" onClick={() => void startCardSession(card)}>
                {t('Run in new session')}
              </button>
              <div className="project-menu-sep" />
              <button
                className="project-menu-item"
                disabled={position === 0}
                onClick={() => moveCardToEdge(card, 0)}
              >
                {t('Move to top')}
              </button>
              <button
                className="project-menu-item"
                disabled={position === inColumn.length - 1}
                onClick={() => moveCardToEdge(card, undefined)}
              >
                {t('Move to bottom')}
              </button>
              <div className="project-menu-sep" />
              <button
                className="project-menu-item danger"
                onClick={() => {
                  setCardMenu(null)
                  void deleteCard(card)
                }}
              >
                {t('Delete')}
              </button>
            </div>
          )
        })()}
      {modalCardId !== null && cardById(modalCardId) !== undefined && (
        <CardModal
          tab={tab}
          board={board}
          cardId={modalCardId}
          apply={apply}
          onError={setError}
          onClose={() => setModalCardId(null)}
        />
      )}
      {workflowOpen && <WorkflowModal tab={tab} board={board} apply={apply} onClose={() => setWorkflowOpen(false)} />}
      {moveCardsFrom !== null && (
        <div
          className="board-modal-overlay"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setMoveCardsFrom(null)
          }}
        >
          <div className="board-modal board-move-cards-modal">
            <header className="board-modal-head">
              <span className="board-modal-heading">{t('Move tasks to')}</span>
              <button className="settings-close" title={t('Close')} onClick={() => setMoveCardsFrom(null)}>
                ×
              </button>
            </header>
            <div className="board-modal-body">
              <select
                className="board-column-select"
                value={moveCardsTarget}
                onChange={(e) => setMoveCardsTarget(e.target.value)}
              >
                {board.columns
                  .filter((column) => column.id !== moveCardsFrom)
                  .map((column) => (
                    <option key={column.id} value={column.id}>
                      {column.name}
                    </option>
                  ))}
              </select>
            </div>
            <footer className="board-modal-foot">
              <button className="board-primary" disabled={moveCardsTarget.length === 0} onClick={submitMoveCards}>
                {t('Move')}
              </button>
              <button onClick={() => setMoveCardsFrom(null)}>{t('Cancel')}</button>
            </footer>
          </div>
        </div>
      )}
    </div>
  )
}

function WorkflowModal({
  tab,
  board,
  apply,
  onClose,
}: {
  tab: ProjectTab
  board: KanbanBoard
  apply: (result: KanbanMutationResult) => void
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const [text, setText] = useState(board.workflow)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const save = (): void => {
    if (text === board.workflow) {
      onClose()
      return
    }
    void window.piwright.kanbanWorkflowSet(tab.project, board.id, text).then((result) => {
      apply(result)
      if (result.ok) onClose()
    })
  }

  return (
    <div
      className="board-modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="board-modal board-workflow-modal">
        <header className="board-modal-head">
          <span className="board-modal-heading">{t('Edit workflow')}</span>
          <button className="settings-close" title={t('Close')} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="board-modal-body">
          <textarea
            className="board-workflow-textarea"
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.ctrlKey && e.key === 'Enter') save()
            }}
          />
        </div>
        <footer className="board-modal-foot board-workflow-foot">
          <button className="board-primary" onClick={save}>
            {t('Save')}
          </button>
          <button onClick={onClose}>{t('Cancel')}</button>
        </footer>
      </div>
    </div>
  )
}

function CardModal({
  tab,
  board,
  cardId,
  apply,
  onError,
  onClose,
}: {
  tab: ProjectTab
  board: KanbanBoard
  cardId: string
  apply: (result: KanbanMutationResult) => void
  onError: (message: string) => void
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const lang = useLang()
  const card = board.cards.find((item) => item.id === cardId)
  const [title, setTitle] = useState(card?.title ?? '')
  const [description, setDescription] = useState(card?.description ?? '')
  const [comment, setComment] = useState('')
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editCommentText, setEditCommentText] = useState('')
  const [pendingImages, setPendingImages] = useState<{ name: string; path: string }[]>([])
  const [lightbox, setLightbox] = useState<string | null>(null)
  const lightboxRef = useRef<string | null>(null)
  const uploadingRef = useRef(false)
  const cardFileRef = useRef<HTMLInputElement | null>(null)
  const commentFileRef = useRef<HTMLInputElement | null>(null)

  const setLightboxSafe = (src: string | null): void => {
    lightboxRef.current = src
    setLightbox(src)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (lightboxRef.current !== null) {
        setLightboxSafe(null)
        return
      }
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (card === undefined) return <></>

  const uploadFiles = async (files: File[]): Promise<{ name: string; path: string }[]> => {
    if (uploadingRef.current || files.length === 0) return []
    uploadingRef.current = true
    const uploaded: { name: string; path: string }[] = []
    for (const file of files) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const res = await window.piwright.kanbanAttachmentPut(tab.project, file.name.length > 0 ? file.name : 'pasted.png', base64FromBytes(bytes))
        if (res.ok) uploaded.push({ name: res.name, path: res.path })
        else onError(res.error ?? 'Upload failed')
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err))
      }
    }
    uploadingRef.current = false
    return uploaded
  }

  const addCardImages = (files: File[]): void => {
    void uploadFiles(files).then((uploaded) => {
      if (uploaded.length === 0) return
      void window.piwright
        .kanbanCardUpdate(tab.project, board.id, { id: card.id, images: [...card.images, ...uploaded.map((item) => item.path)] })
        .then(apply)
    })
  }

  const removeCardImage = (path: string): void => {
    void window.piwright.kanbanCardUpdate(tab.project, board.id, { id: card.id, images: card.images.filter((item) => item !== path) }).then(apply)
  }

  const addCommentImages = (files: File[]): void => {
    void uploadFiles(files).then((uploaded) => {
      if (uploaded.length === 0) return
      setPendingImages((prev) => [...prev, ...uploaded])
    })
  }

  const pasteImages = (e: React.ClipboardEvent): void => {
    const files = Array.from(e.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)
    if (files.length === 0) return
    e.preventDefault()
    if (e.target instanceof HTMLTextAreaElement && e.target.classList.contains('board-comment-input')) addCommentImages(files)
    else addCardImages(files)
  }

  const saveDetails = async (): Promise<void> => {
    const nextTitle = title.trim()
    if (nextTitle === card.title && description === card.description) return
    const result = await window.piwright.kanbanCardUpdate(tab.project, board.id, {
      id: card.id,
      ...(nextTitle.length > 0 && nextTitle !== card.title ? { title: nextTitle } : {}),
      ...(description !== card.description ? { description } : {}),
    })
    apply(result)
  }

  const addComment = async (): Promise<void> => {
    const text = comment.trim()
    if (text.length === 0 && pendingImages.length === 0) return
    setComment('')
    const images = pendingImages.map((item) => item.path)
    setPendingImages([])
    const result = await window.piwright.kanbanCardComment(tab.project, board.id, { cardId: card.id, text, images })
    apply(result)
  }

  const startEditComment = (item: { id: string; text: string }): void => {
    setEditingCommentId(item.id)
    setEditCommentText(item.text)
  }

  const cancelEditComment = (): void => {
    setEditingCommentId(null)
    setEditCommentText('')
  }

  const saveEditComment = async (): Promise<void> => {
    if (editingCommentId === null) return
    const text = editCommentText.trim()
    if (text.length === 0) return
    const result = await window.piwright.kanbanCommentUpdate(tab.project, board.id, {
      cardId: card.id,
      commentId: editingCommentId,
      text,
    })
    cancelEditComment()
    apply(result)
  }

  const removeComment = async (commentId: string): Promise<void> => {
    const ok = await confirmDialog({
      message: t('Delete comment?'),
      confirmLabel: t('Delete'),
      danger: true,
    })
    if (!ok) return
    apply(await window.piwright.kanbanCommentDelete(tab.project, board.id, card.id, commentId))
  }

  const saveAndClose = async (): Promise<void> => {
    await saveDetails()
    await addComment()
    onClose()
  }

  const moveCardToColumn = (columnId: string): void => {
    if (columnId === card.columnId) return
    void window.piwright.kanbanCardMove(tab.project, board.id, { id: card.id, columnId }).then(apply)
  }

  const removeCard = async (): Promise<void> => {
    const ok = await confirmDialog({
      message: t('Delete card "{title}"?', { title: card.title }),
      confirmLabel: t('Delete'),
      danger: true,
    })
    if (!ok) return
    apply(await window.piwright.kanbanCardDelete(tab.project, board.id, card.id))
    onClose()
  }

  const locale = lang === 'ru' ? 'ru-RU' : 'en-US'

  return (
    <div className="board-card-overlay">
      <div className="board-modal" onPaste={pasteImages}>
        <header className="board-modal-head">
          <input
            className="board-modal-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => void saveDetails()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
          <button className="settings-close" title={t('Close')} onClick={onClose}>
            ×
          </button>
        </header>
        <div className="board-modal-body">
          <textarea
            className="board-modal-description"
            placeholder={t('Description')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => void saveDetails()}
          />
          <div className="board-modal-description-actions">
            <button className="board-danger" onClick={() => void removeCard()}>
              {t('Delete card')}
            </button>
            <button className="board-primary" onClick={() => void saveAndClose()}>
              {t('Ok')}
            </button>
          </div>
          <div className="board-card-images">
            {card.images.map((path) => (
              <div key={path} className="board-thumb-wrap">
                <KanbanThumb project={tab.project} path={path} onOpen={setLightboxSafe} />
                <button className="board-thumb-remove" title={t('Remove image')} onClick={() => removeCardImage(path)}>
                  ×
                </button>
              </div>
            ))}
            <button className="board-thumb-add" title={t('Attach image')} onClick={() => cardFileRef.current?.click()}>
              +
            </button>
          </div>
          <div className="board-comments">
            {card.comments.map((item) => (
              <div key={item.id} className="board-comment">
                <div className="board-comment-meta">
                  <span className={item.author === 'agent' ? 'board-comment-author agent' : 'board-comment-author user'}>
                    {item.author === 'agent' ? t('Agent') : t('You')}
                  </span>
                  <span className="board-comment-date">{new Date(item.at).toLocaleString(locale)}</span>
                  {item.author === 'user' && editingCommentId !== item.id && (
                    <div className="board-comment-actions">
                      <button title={t('Edit')} onClick={() => startEditComment(item)}>
                        ✏️
                      </button>
                      <button title={t('Delete')} onClick={() => void removeComment(item.id)}>
                        ×
                      </button>
                    </div>
                  )}
                </div>
                {editingCommentId === item.id ? (
                  <>
                    <textarea
                      className="board-comment-edit"
                      value={editCommentText}
                      autoFocus
                      onChange={(e) => setEditCommentText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.ctrlKey && e.key === 'Enter') void saveEditComment()
                        if (e.key === 'Escape') cancelEditComment()
                      }}
                    />
                    <div className="board-comment-edit-actions">
                      <button className="board-primary" onClick={() => void saveEditComment()}>
                        {t('Save')}
                      </button>
                      <button onClick={cancelEditComment}>{t('Cancel')}</button>
                    </div>
                  </>
                ) : (
                  <div className="board-comment-text">{item.text}</div>
                )}
                {(item.session !== undefined || (item.commits?.length ?? 0) > 0) && (
                  <div className="board-comment-refs">
                    {item.session !== undefined && <SessionChip project={tab.project} session={item.session} />}
                    {item.commits?.map((commit) => (
                      <CommitChip key={commit.hash} project={tab.project} commit={commit} />
                    ))}
                  </div>
                )}
                {item.images.length > 0 && (
                  <div className="board-comment-images">
                    {item.images.map((path) => (
                      <KanbanThumb key={path} project={tab.project} path={path} onOpen={setLightboxSafe} />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        <footer className="board-modal-foot">
          {pendingImages.length > 0 && (
            <div className="board-pending-images">
              {pendingImages.map((item) => (
                <span key={item.path} className="board-pending-image" title={item.name}>
                  🖼 {item.name}
                  <button
                    className="board-pending-remove"
                    title={t('Remove image')}
                    onClick={() => setPendingImages((prev) => prev.filter((p) => p.path !== item.path))}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <textarea
            className="board-comment-input"
            placeholder={t('Add comment')}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            onKeyDown={(e) => {
              if (e.ctrlKey && e.key === 'Enter') void addComment()
            }}
          />
          <div className="board-modal-actions">
            <select
              className="board-column-select"
              title={t('Move to column')}
              value={card.columnId}
              onChange={(e) => moveCardToColumn(e.target.value)}
            >
              {board.columns.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.name}
                </option>
              ))}
            </select>
            <button className="board-attach" title={t('Attach image')} onClick={() => commentFileRef.current?.click()}>
              📎
            </button>
            <button className="board-primary" onClick={() => void addComment()}>
              {t('Send comment')}
            </button>
          </div>
          <input
            ref={cardFileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              addCardImages(Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />
          <input
            ref={commentFileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              addCommentImages(Array.from(e.target.files ?? []))
              e.target.value = ''
            }}
          />
        </footer>
        {lightbox !== null && <Lightbox src={lightbox} alt="" onClose={() => setLightboxSafe(null)} />}
      </div>
    </div>
  )
}
