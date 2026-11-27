/** Состояние DB-панели (правый рельс): дерево подключение → схемы → таблицы. Подключения —
 *  глобальные (settings.dbConnections), не зависят от проекта. Схемы и таблицы грузятся лениво
 *  при раскрытии узла; выбор схем (чекбоксы) персистится в DbConnectionEntry.selectedSchemas. */
import { create } from 'zustand'
import type { DbConnectionEntry } from '../../../shared/ipc-contracts'
import { useSessionsStore } from './sessions'

/** Ключ списков таблиц: схемы живут в пространстве имён подключения. */
export function dbTablesKey(connectionId: string, schema: string): string {
  return `${connectionId}\u0000${schema}`
}

interface DbState {
  /** Панель видима (кнопка в вертикальной панели справа). */
  open: boolean
  /** Ширина панели, тянется за левую границу. */
  width: number
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
  load: () => Promise<void>
  /** Перечитать подключения и сбросить кэши схем/таблиц; раскрытые узлы перезагружаются. */
  refresh: () => Promise<void>
  toggleConnection: (id: string) => void
  toggleSchema: (connectionId: string, schema: string) => void
  /** Чекбоксы схем: список видимых схем подключения (undefined — все); персист в settings. */
  setSelectedSchemas: (connectionId: string, selectedSchemas: string[] | undefined) => void
  setError: (error: string | null) => void
  toggleOpen: () => void
  setWidth: (width: number) => void
}

let persistChain: Promise<void> = Promise.resolve()

function persistSelectedSchemas(connectionId: string, selectedSchemas: string[] | undefined): void {
  persistChain = persistChain
    .then(async () => {
      const settings = useSessionsStore.getState().settings
      if (settings === null) return
      const patch = {
        dbConnections: settings.dbConnections.map((c) => (c.id === connectionId ? { ...c, selectedSchemas } : c))
      }
      const saved = await window.piwright.setSettings(patch)
      useSessionsStore.getState().setSettings(saved)
    })
    .catch(() => {})
}

export const useDbStore = create<DbState>((set, get) => ({
  open: false,
  width: 340,
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

  load: async () => {
    if (get().connectionsLoaded || get().connectionsLoading) return
    set({ connectionsLoading: true })
    const result = await window.piwright.dbConnectionsList()
    set((state) => ({
      connectionsLoading: false,
      connectionsLoaded: true,
      connections: result.ok ? result.connections : state.connections,
      error: result.ok ? state.error : result.error
    }))
  },

  refresh: async () => {
    const result = await window.piwright.dbConnectionsList()
    if (!result.ok) {
      set({ error: result.error })
      return
    }
    set({
      connections: result.connections,
      schemasByConnection: {},
      tablesBySchema: {},
      schemasLoading: {},
      tablesLoading: {}
    })
    for (const id of get().expandedConnections) await ensureSchemas(id)
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
    void ensureSchemas(id)
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
    persistSelectedSchemas(connectionId, selectedSchemas)
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
