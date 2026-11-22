import { useEffect, useRef, useState } from 'react'
import { applyCardMove } from '../../../../shared/kanban'
import type { KanbanBoard, KanbanCard } from '../../../../shared/kanban'
import type { KanbanMutationResult } from '../../../../shared/ipc-contracts'
import type { ProjectTab } from '../../stores/tabs'
import { useLang, useT } from '../../lib/i18n'
import { confirmDialog } from '../../components/ConfirmDialog'

interface DropTarget {
  columnId: string
  index: number
}

/** Вкладка-доска: колонки в ряд, DnD карточек (между колонками и внутри), CRUD колонок,
 *  модалка карточки (описание, комментарии, удаление). */
export function BoardView({ tab }: { tab: ProjectTab }): React.JSX.Element {
  const t = useT()
  const [board, setBoard] = useState<KanbanBoard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [modalCardId, setModalCardId] = useState<string | null>(null)
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
  const boardId = tab.boardId

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
        >
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
        {board.columns.map((column, columnIndex) => {
          const cards = board.cards.filter((card) => card.columnId === column.id).sort((a, b) => a.order - b.order)
          return (
            <div
              key={column.id}
              className="board-column"
              onDragOver={(e) => columnDragOver(e, column.id)}
              onDragLeave={(e) => columnDragLeave(e, column.id)}
              onDrop={columnDrop}
            >
              <div className="board-column-head">
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
                      title={t('Move left')}
                      disabled={columnIndex === 0}
                      onClick={() => moveColumn(column.id, columnIndex - 1)}
                    >
                      ←
                    </button>
                    <button
                      className="board-column-btn"
                      title={t('Move right')}
                      disabled={columnIndex === board.columns.length - 1}
                      onClick={() => moveColumn(column.id, columnIndex + 1)}
                    >
                      →
                    </button>
                    <button className="board-column-btn" title={t('Delete column')} onClick={() => void deleteColumn(column.id, column.name)}>
                      ✕
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
      {modalCardId !== null && cardById(modalCardId) !== undefined && (
        <CardModal tab={tab} board={board} cardId={modalCardId} apply={apply} onClose={() => setModalCardId(null)} />
      )}
    </div>
  )
}

function CardModal({
  tab,
  board,
  cardId,
  apply,
  onClose,
}: {
  tab: ProjectTab
  board: KanbanBoard
  cardId: string
  apply: (result: KanbanMutationResult) => void
  onClose: () => void
}): React.JSX.Element {
  const t = useT()
  const lang = useLang()
  const card = board.cards.find((item) => item.id === cardId)
  const [title, setTitle] = useState(card?.title ?? '')
  const [description, setDescription] = useState(card?.description ?? '')
  const [comment, setComment] = useState('')

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (card === undefined) return <></>

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
    if (text.length === 0) return
    setComment('')
    const result = await window.piwright.kanbanCardComment(tab.project, board.id, { cardId: card.id, text })
    apply(result)
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
    <div
      className="board-modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="board-modal">
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
          <div className="board-comments">
            {card.comments.map((item) => (
              <div key={item.id} className="board-comment">
                <div className="board-comment-meta">
                  <span className={item.author === 'agent' ? 'board-comment-author agent' : 'board-comment-author user'}>
                    {item.author === 'agent' ? t('Agent') : t('You')}
                  </span>
                  <span className="board-comment-date">{new Date(item.at).toLocaleString(locale)}</span>
                </div>
                <div className="board-comment-text">{item.text}</div>
              </div>
            ))}
          </div>
        </div>
        <footer className="board-modal-foot">
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
            <button className="board-danger" onClick={() => void removeCard()}>
              {t('Delete card')}
            </button>
            <button className="board-primary" onClick={() => void addComment()}>
              {t('Add')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
