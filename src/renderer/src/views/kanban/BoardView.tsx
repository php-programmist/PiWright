import { useEffect, useState } from 'react'
import type { KanbanBoard } from '../../../../shared/kanban'
import type { ProjectTab } from '../../stores/tabs'
import { useT } from '../../lib/i18n'

/** Вкладка-доска (read-only): колонки в ряд, карточки с бейджами комментариев/картинок.
 *  DnD и модалка карточки — следующий тикет. */
export function BoardView({ tab }: { tab: ProjectTab }): React.JSX.Element {
  const t = useT()
  const [board, setBoard] = useState<KanbanBoard | null>(null)
  const [error, setError] = useState<string | null>(null)
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

  if (error !== null) return <div className="board-view"><div className="panel-hint">{error}</div></div>
  if (board === null) return <div className="board-view"><div className="panel-hint">{t('Board not found')}</div></div>

  return (
    <div className="board-view">
      <div className="board-head">
        <span className="board-title">{board.name}</span>
        <span className="board-rev">rev {board.rev}</span>
      </div>
      <div className="board-columns">
        {board.columns.map((column) => {
          const cards = board.cards.filter((c) => c.columnId === column.id).sort((a, b) => a.order - b.order)
          return (
            <div key={column.id} className="board-column">
              <div className="board-column-head">
                <span>{column.name}</span>
                <span className="board-column-count">{cards.length}</span>
              </div>
              <div className="board-column-cards">
                {cards.map((card) => (
                  <div key={card.id} className="board-card">
                    <div className="board-card-title">{card.title}</div>
                    {(card.comments.length > 0 || card.images.length > 0) && (
                      <div className="board-card-badges">
                        {card.comments.length > 0 && <span className="board-badge" title={t('Comments')}>💬 {card.comments.length}</span>}
                        {card.images.length > 0 && <span className="board-badge" title={t('Images')}>🖼 {card.images.length}</span>}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
