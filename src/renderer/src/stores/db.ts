/** Состояние DB-панели (правый рельс): дерево подключение → схемы → таблицы. Подключения —
 *  на проект (settings.projectDbConnections[projectKey]); смена проекта перезагружает список.
 *  Схемы и таблицы грузятся лениво при раскрытии узла; выбор схем (чекбоксы) персистится
 *  в DbConnectionEntry.selectedSchemas. */
import { create } from 'zustand'
import type { DbConnectionEntry, DbPendingChange } from '../../../shared/ipc-contracts'
import { useSessionsStore } from './sessions'

/** Ключ списков таблиц: схемы живут в пространстве имён подключения. */
export function dbTablesKey(connectionId: string, schema: string): string {
  return `${connectionId}\u0000${schema}`
}

/** Ключ буфера правок таблицы. */
export function dbTableKey(connectionId: string, schema: string, table: string): string {
  return `${connectionId}\u0000${schema}\u0000${table}`
}

interface DbState {
  /** Панель видима (кнопка в вертикальной панели справа). */
  open: boolean
  /** Ширина панели, тянется за левую границу. */
  width: number
  /** Ключ проекта, для которого загружен список connections (null — ещё не грузили). */
  connectionsProjectKey: string | null
  connections: DbConnectionEntry[]
  connectionsLoaded: boolean
  connectionsLoading: boolean
  error: string | null
  /** Списки схем по connectionId (undefined — ещё не грузили). */
  schemasByConnection: Record<string, string[]>
  schemasLoading: Record<string, boolean>
  /** Списки таблиц по ключу dbTablesKey(connectionId, schema). */
  tablesBySchema: Record<string, string[]>
  tablesLoading: Record<string, boolean>
  /** Раскрытые узлы дерева. */
  expandedConnections: Set<string>
  expandedSchemas: Set<string>
  /** История запросов консоли per connectionId (в памяти, не персистится, новые сверху). */
  queryHistory: Record<string, string[]>
  pushQueryHistory: (connectionId: string, sql: string) => void
  /** Буфер правок таблицы (ключ dbTableKey) — копится до зелёной стрелки, не персистится. */
  pendingByTable: Record<string, DbPendingChange[]>
  dbPendingSet: (key: string, changes: DbPendingChange[]) => void
  dbPendingClear: (key: string) => void
  /** Кнопка «+» панели БД просит открыть форму нового подключения во вкладке db-settings. */
  addEditorPending: boolean
  requestAddEditor: () => void
  clearAddEditor: () => void
  /** Результат «Проверить» из контекстного меню панели (в памяти). */
  panelTests: Record<string, { running: boolean; ok: boolean; text: string }>
  setPanelTest: (connectionId: string, result?: { running: boolean; ok: boolean; text: string }) => void
  /** Загрузить подключения проекта (повторный вызов с тем же ключом — no-op). */
  load: (projectKey: string) => Promise<void>
  /** Перечитать подключения проекта и сбросить кэши схем/таблиц; раскрытые узлы перезагружаются. */
  refresh: (projectKey: string) => Promise<void>
  toggleConnection: (id: string) => void
  toggleSchema: (connectionId: string, schema: string) => void
  /** Чекбоксы схем: список видимых схем подключения (undefined — все); персист в settings. */
  setSelectedSchemas: (connectionId: string, selectedSchemas: string[] | undefined) => void
  setError: (error: string | null) => void
  toggleOpen: () => void
  setWidth: (width: number) => void
}

let persistChain: Promise<void> = Promise.resolve()

function persistSelectedSchemas(projectKey: string, connectionId: string, selectedSchemas: string[] | undefined): void {
  persistChain = persistChain
    .then(async () => {
      const settings = useSessionsStore.getState().settings
      if (settings === null) return
      const map = settings.projectDbConnections
      const patch = {
        projectDbConnections: {
          ...map,
          [projectKey]: (map[projectKey] ?? []).map((c) => (c.id === connectionId ? { ...c, selectedSchemas } : c))
        }
      }
      const saved = await window.piwright.setSettings(patch)
      useSessionsStore.getState().setSettings(saved)
    })
    .catch(() => {})
}

export const useDbStore = create<DbState>((set, get) => ({
  open: false,
  width: 340,
  connectionsProjectKey: null,
  connections: [],
  connectionsLoaded: false,
  connectionsLoading: false,
  error: null,
  schemasByConnection: {},
  schemasLoading: {},
  tablesBySchema: {},
  tablesLoading: {},
  expandedConnections: new Set(),
  expandedSchemas: new Set(),
  queryHistory: {},

  pushQueryHistory: (connectionId, sql) => {
    set((state) => ({
      queryHistory: { ...state.queryHistory, [connectionId]: [sql, ...state.queryHistory[connectionId]?.filter((q) => q !== sql) ?? []].slice(0, 50) }
    }))
  },

  pendingByTable: {},
  dbPendingSet: (key, changes) =>
    set((state) => {
      const pendingByTable = { ...state.pendingByTable }
      if (changes.length === 0) delete pendingByTable[key]
      else pendingByTable[key] = changes
      return { pendingByTable }
    }),
  dbPendingClear: (key) =>
    set((state) => {
      if (state.pendingByTable[key] === undefined) return state
      const pendingByTable = { ...state.pendingByTable }
      delete pendingByTable[key]
      return { pendingByTable }
    }),

  addEditorPending: false,
  requestAddEditor: () => set({ addEditorPending: true }),
  clearAddEditor: () => set({ addEditorPending: false }),

  panelTests: {},
  setPanelTest: (connectionId, result) =>
    set((state) => {
      const panelTests = { ...state.panelTests }
      if (result === undefined) delete panelTests[connectionId]
      else panelTests[connectionId] = result
      return { panelTests }
    }),

  load: async (projectKey) => {
    if (get().connectionsProjectKey === projectKey && (get().connectionsLoaded || get().connectionsLoading)) return
    set({ connectionsLoading: true })
    const result = await window.piwright.dbConnectionsList(projectKey)
    set((state) => ({
      connectionsLoading: false,
      connectionsProjectKey: projectKey,
      connectionsLoaded: true,
      connections: result.ok ? result.connections : state.connections,
      error: result.ok ? state.error : result.error
    }))
  },

  refresh: async (projectKey) => {
    const result = await window.piwright.dbConnectionsList(projectKey)
    if (!result.ok) {
      set({ error: result.error })
      return
    }
    set({
      connectionsProjectKey: projectKey,
      connections: result.connections,
      schemasByConnection: {},
      tablesBySchema: {},
      schemasLoading: {},
      tablesLoading: {}
    })
    for (const id of get().expandedConnections) {
      // Единственная выбранная схема — в дереве таблицы вместо схем, перезагружаем именно их.
      const selected = get().connections.find((c) => c.id === id)?.selectedSchemas
      if (selected !== undefined && selected.length === 1) await ensureTables(id, selected[0])
      else await ensureSchemas(id)
    }
  },

  toggleConnection: (id) => {
    const expanded = new Set(get().expandedConnections)
    if (expanded.has(id)) {
      expanded.delete(id)
      set({ expandedConnections: expanded })
      return
    }
    expanded.add(id)
    set({ expandedConnections: expanded })
    // Единственная выбранная схема — таблицы грузим сразу, уровень схемы в дереве не показываем.
    const selected = get().connections.find((c) => c.id === id)?.selectedSchemas
    if (selected !== undefined && selected.length === 1) void ensureTables(id, selected[0])
    else void ensureSchemas(id)
  },

  toggleSchema: (connectionId, schema) => {
    const key = dbTablesKey(connectionId, schema)
    const expanded = new Set(get().expandedSchemas)
    if (expanded.has(key)) {
      expanded.delete(key)
      set({ expandedSchemas: expanded })
      return
    }
    expanded.add(key)
    set({ expandedSchemas: expanded })
    void ensureTables(connectionId, schema)
  },

  setSelectedSchemas: (connectionId, selectedSchemas) => {
    set((state) => ({
      connections: state.connections.map((c) => (c.id === connectionId ? { ...c, selectedSchemas } : c))
    }))
    const projectKey = get().connectionsProjectKey
    if (projectKey !== null) persistSelectedSchemas(projectKey, connectionId, selectedSchemas)
  },

  setError: (error) => set({ error }),
  toggleOpen: () => set((state) => ({ open: !state.open })),
  setWidth: (width) => set({ width: Math.min(Math.max(width, 280), window.innerWidth - 560) })
}))

/** Ленивая загрузка схем подключения (раскрытие узла или refresh). */
export async function ensureSchemas(id: string): Promise<void> {
  const state = useDbStore.getState()
  if (state.schemasByConnection[id] !== undefined || state.schemasLoading[id] === true) return
  useDbStore.setState((s) => ({ schemasLoading: { ...s.schemasLoading, [id]: true } }))
  const result = await window.piwright.dbSchemas(id)
  useDbStore.setState((s) => {
    const schemasLoading = { ...s.schemasLoading }
    delete schemasLoading[id]
    return result.ok
      ? { schemasLoading, schemasByConnection: { ...s.schemasByConnection, [id]: result.schemas } }
      : { schemasLoading, error: result.error }
  })
}

/** Ленивая загрузка таблиц схемы. */
export async function ensureTables(connectionId: string, schema: string): Promise<void> {
  const key = dbTablesKey(connectionId, schema)
  const state = useDbStore.getState()
  if (state.tablesBySchema[key] !== undefined || state.tablesLoading[key] === true) return
  useDbStore.setState((s) => ({ tablesLoading: { ...s.tablesLoading, [key]: true } }))
  const result = await window.piwright.dbTables(connectionId, schema)
  useDbStore.setState((s) => {
    const tablesLoading = { ...s.tablesLoading }
    delete tablesLoading[key]
    return result.ok
      ? { tablesLoading, tablesBySchema: { ...s.tablesBySchema, [key]: result.tables } }
      : { tablesLoading, error: result.error }
  })
}
