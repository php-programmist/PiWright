import { useEffect, useState } from 'react'
import { useCenterProject, useTabsStore } from '../../stores/tabs'
import { useKanbanStore } from '../../stores/kanban'
import { useT } from '../../lib/i18n'
import { persistPanel } from '../../stores/panels-prefs'
import { confirmDialog } from '../../components/ConfirmDialog'

/** Панель досок канбана (правый рельс): список досок проекта, добавить / переименовать /
 *  удалить (confirm), клик по названию — вкладка с доской. */
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

  useEffect(() => {
    useKanbanStore.getState().setProject(project)
  }, [project])

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

  const submitRename = (): void => {
    const name = renameText.trim()
    const id = renamingId
    setRenamingId(null)
    setRenameText('')
    if (name.length === 0 || id === null || project === null) return
    void useKanbanStore.getState().rename(project, id, name)
  }

  const deleteBoard = async (boardId: string, name: string): Promise<void> => {
    const ok = await confirmDialog({ message: t('Delete board "{name}"?', { name }), confirmLabel: t('Delete'), danger: true })
    if (!ok || project === null) return
    void useKanbanStore.getState().remove(project, boardId)
  }

  return (
    <aside className="kanban-panel" style={{ width }}>
      <div className="git-resizer" onMouseDown={startResize} />
      <div className="git-head">
        <span>{t('Kanban')}</span>
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
          boards.map((board) => (
            <div key={board.id} className="kanban-board-row">
              {renamingId === board.id ? (
                <input
                  className="kanban-name-input"
                  autoFocus
                  value={renameText}
                  onChange={(e) => setRenameText(e.target.value)}
                  onBlur={submitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') submitRename()
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                />
              ) : (
                <>
                  <button
                    className="kanban-board-name"
                    title={t('Open board')}
                    onClick={() => {
                      if (project !== null) useTabsStore.getState().openTab(project, { kind: 'kanban', boardId: board.id, title: board.name })
                    }}
                  >
                    {board.name}
                  </button>
                  <span className="kanban-board-count">{board.cards}</span>
                  <button
                    className="kanban-board-action"
                    title={t('Rename board')}
                    onClick={() => {
                      setRenamingId(board.id)
                      setRenameText(board.name)
                    }}
                  >
                    ✎
                  </button>
                  <button
                    className="kanban-board-action"
                    title={t('Delete board')}
                    onClick={() => void deleteBoard(board.id, board.name)}
                  >
                    ✕
                  </button>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </aside>
  )
}
