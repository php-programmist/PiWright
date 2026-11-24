/** Состояние дерева задач в панели канбана (раскрытые доски, свёрнутые колонки) —
 *  в настройках, переживает перезапуск. */
import { projectKey, useSessionsStore } from '../stores/sessions'
import type { ProjectEntry } from '../../../shared/ipc-contracts'
import type { KanbanTheme } from '../../../shared/kanban-theme'
import { resolveKanbanTheme } from '../../../shared/kanban-theme'
import { useKanbanThemeStore } from '../stores/kanban-theme'

export function boardExpandedKey(project: ProjectEntry, boardId: string): string {
  return `${projectKey(project)}\u0000${boardId}`
}

export function columnCollapsedKey(project: ProjectEntry, boardId: string, columnId: string): string {
  return `${projectKey(project)}\u0000${boardId}\u0000${columnId}`
}

/** Тема досок из настроек (null — канбан выключен, цвета системные). */
export function useBoardTheme(): KanbanTheme | null {
  const settings = useSessionsStore((s) => s.settings)
  const custom = useKanbanThemeStore((s) => s.custom)
  if (settings === null || !settings.kanbanEnabled) return null
  return resolveKanbanTheme(custom, settings.kanbanTheme)
}

export function useBoardExpanded(project: ProjectEntry, boardId: string): boolean {
  return useSessionsStore((s) => s.settings?.kanbanBoardsExpanded[boardExpandedKey(project, boardId)] ?? false)
}

export function useColumnCollapsed(project: ProjectEntry, boardId: string, columnId: string): boolean {
  return useSessionsStore((s) => s.settings?.kanbanColumnsCollapsed[columnCollapsedKey(project, boardId, columnId)] ?? false)
}

function writeFlags(field: 'kanbanBoardsExpanded' | 'kanbanColumnsCollapsed', flags: Record<string, boolean>): void {
  const store = useSessionsStore.getState()
  const settings = store.settings
  if (settings === null) return
  void window.piwright.setSettings({ [field]: flags }).then((saved) => store.setSettings(saved))
}

function currentFlags(field: 'kanbanBoardsExpanded' | 'kanbanColumnsCollapsed'): Record<string, boolean> {
  return useSessionsStore.getState().settings?.[field] ?? {}
}

export function toggleBoardExpanded(project: ProjectEntry, boardId: string): void {
  const key = boardExpandedKey(project, boardId)
  const flags = { ...currentFlags('kanbanBoardsExpanded') }
  if (flags[key] === true) delete flags[key]
  else flags[key] = true
  writeFlags('kanbanBoardsExpanded', flags)
}

export function toggleColumnCollapsed(project: ProjectEntry, boardId: string, columnId: string): void {
  const key = columnCollapsedKey(project, boardId, columnId)
  const flags = { ...currentFlags('kanbanColumnsCollapsed') }
  if (flags[key] === true) delete flags[key]
  else flags[key] = true
  writeFlags('kanbanColumnsCollapsed', flags)
}

/** Все колонки доски сразу (пункт меню «Свернуть/Развернуть все»). */
export function setColumnsCollapsed(project: ProjectEntry, boardId: string, columnIds: string[], collapsed: boolean): void {
  const flags = { ...currentFlags('kanbanColumnsCollapsed') }
  for (const columnId of columnIds) {
    const key = columnCollapsedKey(project, boardId, columnId)
    if (collapsed) flags[key] = true
    else delete flags[key]
  }
  writeFlags('kanbanColumnsCollapsed', flags)
}
