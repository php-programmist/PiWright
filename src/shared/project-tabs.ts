/** Вкладки проекта (файлы/диффы/MCP/навыки) — переживают перезапуск. Сессии и транскрипты
 *  не сохраняются: сессии не возобновляются при открытии проекта (решение юзера). */
import type { Settings } from './ipc-contracts'

export type ProjectTabKind = 'file' | 'diff' | 'mcp' | 'skills' | 'kanban' | 'task' | 'db-table' | 'db-console'

export interface SavedProjectTab {
  kind: ProjectTabKind
  /** file/diff — относительный путь; mcp/skills — вкладка одна на проект. */
  path?: string
  /** diff — хеш коммита (дифф из истории). */
  hash?: string
  /** kanban/task — id доски. */
  boardId?: string
  /** task — id карточки. */
  taskId?: string
  /** db-table — подключение/схема/таблица дерева БД; db-console — подключение консоли. */
  connectionId?: string
  schema?: string
  table?: string
  /** kanban/task/db-table/db-console — имя доски / заголовок задачи / подпись таблицы / имя подключения. */
  title?: string
}

export interface ProjectTabsSnapshot {
  tabs: SavedProjectTab[]
  /** Индекс активной вкладки в tabs. */
  activeIndex?: number
}

export const PROJECT_TABS_MAX = 32

/** Снимок вкладок проекта в настройки; null — удалить ключ. */
export function setProjectTabs(settings: Settings, key: string, snapshot: ProjectTabsSnapshot | null): Partial<Settings> {
  const next = { ...settings.projectTabs }
  if (snapshot === null) delete next[key]
  else next[key] = snapshot
  return { projectTabs: next }
}

/** projectTabs из файла/settings:set поверх дефолтов: строковые ключи, валидные kind,
 *  опциональные строковые path, активный индекс в границах. */
export function mergeProjectTabs(value: unknown): Record<string, ProjectTabsSnapshot> {
  const out: Record<string, ProjectTabsSnapshot> = {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return out
  const kinds: ProjectTabKind[] = ['file', 'diff', 'mcp', 'skills', 'kanban', 'task', 'db-table', 'db-console']
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (key.length === 0 || raw === null || typeof raw !== 'object' || Array.isArray(raw)) continue
    const rawTabs = (raw as Record<string, unknown>)['tabs']
    if (!Array.isArray(rawTabs)) continue
    const tabs: SavedProjectTab[] = []
    for (const item of rawTabs) {
      if (tabs.length >= PROJECT_TABS_MAX) break
      if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
      const kind = (item as Record<string, unknown>)['kind']
      if (typeof kind !== 'string' || !kinds.includes(kind as ProjectTabKind)) continue
      const path = (item as Record<string, unknown>)['path']
      const hash = (item as Record<string, unknown>)['hash']
      const boardId = (item as Record<string, unknown>)['boardId']
      const taskId = (item as Record<string, unknown>)['taskId']
      const connectionId = (item as Record<string, unknown>)['connectionId']
      const schema = (item as Record<string, unknown>)['schema']
      const table = (item as Record<string, unknown>)['table']
      const title = (item as Record<string, unknown>)['title']
      const tab: SavedProjectTab = { kind: kind as ProjectTabKind }
      if (typeof path === 'string' && path.length > 0) tab.path = path
      if (typeof hash === 'string' && hash.length > 0) tab.hash = hash
      if (typeof boardId === 'string' && boardId.length > 0) tab.boardId = boardId
      if (typeof taskId === 'string' && taskId.length > 0) tab.taskId = taskId
      if (typeof connectionId === 'string' && connectionId.length > 0) tab.connectionId = connectionId
      if (typeof schema === 'string' && schema.length > 0) tab.schema = schema
      if (typeof table === 'string' && table.length > 0) tab.table = table
      if (typeof title === 'string' && title.length > 0) tab.title = title
      if (kind === 'kanban' && tab.boardId === undefined) continue
      if (kind === 'task' && (tab.boardId === undefined || tab.taskId === undefined)) continue
      if (kind === 'db-table' && (tab.connectionId === undefined || tab.schema === undefined || tab.table === undefined)) continue
      if (kind === 'db-console' && tab.connectionId === undefined) continue
      tabs.push(tab)
    }
    if (tabs.length === 0) continue
    const snapshot: ProjectTabsSnapshot = { tabs }
    const activeIndex = (raw as Record<string, unknown>)['activeIndex']
    if (typeof activeIndex === 'number' && Number.isInteger(activeIndex) && activeIndex >= 0 && activeIndex < tabs.length) {
      snapshot.activeIndex = activeIndex
    }
    out[key] = snapshot
  }
  return out
}
