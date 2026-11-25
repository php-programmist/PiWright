import { useCallback, useEffect, useRef, useState } from 'react'
import { applyCardMove } from '../../../../shared/kanban'
import type { KanbanBoard, KanbanCard, KanbanColumn } from '../../../../shared/kanban'
import type { KanbanMutationResult } from '../../../../shared/ipc-contracts'
import { draftMap, loopExitMap, useChatStore } from '../../stores/chat'
import { useSessionsStore, projectKey } from '../../stores/sessions'
import { parentTabKey, useTabsStore } from '../../stores/tabs'
import { useKanbanStore } from '../../stores/kanban'
import type { ProjectTab } from '../../stores/tabs'
import { useT } from '../../lib/i18n'
import { kanbanColumnStyle } from '../../lib/appearance'
import { useBoardTheme } from '../../lib/kanban-tree-prefs'
import { dismissCardAttention } from '../../lib/kanban-attention'
import { useCardDotInputs } from '../../lib/kanban-card-dot'
import { CardDot } from './CardDot'
import { confirmDialog } from '../../components/ConfirmDialog'
import { copyText } from '../../components/LinkChips'
import { CardPanel } from './CardPanel'

interface DropTarget {
  columnId: string
  index: number
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
  const dotInputs = useCardDotInputs(tab.project)
  // Открытая карточка живёт в сторе: смена вкладки размонтирует BoardView, при возврате модалка восстанавливается.
  const boardKey = `${projectKey(tab.project)}\u0000${boardId ?? ''}`
  const modalCardId = useKanbanStore((s) => s.openCard[boardKey] ?? null)
  // Открытая карточка снимает с неё зелёную точку «сессия закрылась непрочитанной».
  useEffect(() => {
    if (modalCardId !== null) dismissCardAttention(tab.project, boardId ?? '', modalCardId)
  }, [tab.project, boardId, modalCardId])
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

  const reload = useCallback((): void => {
    void window.piwright.kanbanBoardGet(tab.project, boardId ?? '').then((result) => {
      if (result.ok && result.board !== null) setBoard(result.board)
    })
  }, [tab.project, boardId])

  // Агент пишет на диск через pi-расширение напрямую — живое обновление доски (точки статусов,
  // новые карточки) только поллингом; во время DnD не трогаем.

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (dragCardRef.current === null) reload()
    }, 3000)
    return () => window.clearInterval(timer)
  }, [reload])

  const apply = (result: KanbanMutationResult): void => {
    if (!result.ok) {
      setError(result.error)
      reload()
      return
    }
    if (result.board !== null) {
      setBoard(result.board)
      // панель досок справа показывает то же содержимое — синхронизируем её дерево
      void useKanbanStore.getState().refresh(tab.project)
    }
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
        ? t('Kanban. Take the task {task} on the {board} board and complete it', { task: `kanban:task:${card.id}`, board: board.name })
        : t('Kanban. Take the task {task} and complete it', { task: `kanban:task:${card.id}` }),
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
      loopExitMap.set(
        ref.hostId,
        multiBoard
          ? t('The kanban column {name} on the {board} board has no tasks', { name: column.name, board: board.name })
          : t('The kanban column {name} has no tasks', { name: column.name }),
      )
    } else {
      const count = board.cards.filter((card) => card.columnId === column.id).length
      // remaining тратится на спавны после первого хода, итераций выходит max + 1 —
      // лимит на единицу меньше числа задач даёт ровно по итерации на задачу.
      chatStore.setLoopMax(ref.hostId, Math.max(1, count - 1))
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
          <div className="board-card-title-row">
            <CardDot card={card} boardId={boardId ?? ''} inputs={dotInputs} />
            <div className="board-card-title">{card.title}</div>
          </div>
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
              <button
                className="project-menu-item"
                onClick={() => {
                  setCardMenu(null)
                  useTabsStore.getState().openTab(tab.project, { kind: 'task', boardId: board.id, title: card.title, taskId: card.id })
                }}
              >
                {t('Open in separate tab')}
              </button>
              <button className="project-menu-item" onClick={() => void startCardSession(card)}>
                {t('Run in new session')}
              </button>
              <button
                className="project-menu-item"
                onClick={() => {
                  setCardMenu(null)
                  copyText(`kanban:task:${card.id}`)
                }}
              >
                {t('Copy task link')}
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
  return (
    <div className="board-card-overlay">
      <CardPanel
        project={tab.project}
        board={board}
        cardId={cardId}
        apply={apply}
        onError={onError}
        onRequestClose={onClose}
        onDeleted={onClose}
      />
    </div>
  )
}
