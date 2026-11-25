import { useCallback, useEffect, useState } from 'react'
import type { KanbanBoard } from '../../../../shared/kanban'
import type { KanbanMutationResult } from '../../../../shared/ipc-contracts'
import { tabId, useTabsStore, type ProjectTab } from '../../stores/tabs'
import { useKanbanStore } from '../../stores/kanban'
import { useT } from '../../lib/i18n'
import { dismissCardAttention } from '../../lib/kanban-attention'
import { CardPanel } from './CardPanel'

/** Вкладка задачи: та же карточка, что в модалке доски, но постоянная вкладка.
 *  Escape и × закрывают вкладку, после удаления карточки вкладка закрывается сама. */
export function TaskView({ tab }: { tab: ProjectTab }): React.JSX.Element {
  const t = useT()
  const [board, setBoard] = useState<KanbanBoard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const boardId = tab.boardId ?? ''
  const taskId = tab.taskId ?? ''

  useEffect(() => {
    let cancelled = false
    void window.piwright.kanbanBoardGet(tab.project, boardId).then((result) => {
      if (cancelled) return
      if (!result.ok) setError(result.error)
      else setBoard(result.board)
    })
    return () => {
      cancelled = true
    }
  }, [tab.project, boardId])

  const reload = useCallback((): void => {
    void window.piwright.kanbanBoardGet(tab.project, boardId).then((result) => {
      if (result.ok && result.board !== null) setBoard(result.board)
    })
  }, [tab.project, boardId])

  // Агент пишет на диск через pi-расширение напрямую — живое обновление только поллингом.
  useEffect(() => {
    const timer = window.setInterval(reload, 3000)
    return () => window.clearInterval(timer)
  }, [reload])

  // Открытая задача снимает зелёную точку «сессия закрылась непрочитанной».
  useEffect(() => {
    if (boardId !== '' && taskId !== '') dismissCardAttention(tab.project, boardId, taskId)
  }, [tab.project, boardId, taskId])

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

  const close = (): void => {
    useTabsStore.getState().closeTab(tab.project, tabId(tab))
  }

  if (error !== null) return <div className="task-view"><div className="panel-hint">{error}</div></div>
  if (board === null) return <div className="task-view"><div className="panel-hint">{t('Board not found')}</div></div>
  if (board.cards.find((item) => item.id === taskId) === undefined) {
    return <div className="task-view"><div className="panel-hint">{t('Task not found')}</div></div>
  }

  return (
    <div className="task-view">
      <CardPanel
        project={tab.project}
        board={board}
        cardId={taskId}
        apply={apply}
        onError={setError}
        onRequestClose={close}
        onDeleted={close}
      />
    </div>
  )
}
