/** Store DB-панели: ленивые схемы/таблицы, чекбоксы схем с персистом selectedSchemas. */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { dbTablesKey, useDbStore } from '../src/renderer/src/stores/db'
import { useSessionsStore } from '../src/renderer/src/stores/sessions'
import type { Settings } from '../src/shared/ipc-contracts'

const connection = {
  id: 'db-abc',
  name: 'local',
  kind: 'postgres' as const,
  host: 'localhost',
  port: 5432,
  database: 'app',
  user: 'postgres',
  authType: 'password' as const
}

const PROJECT_KEY = 'native\u0000C:\\proj'

function seedSettings(projectDbConnections: Record<string, unknown[]>): Settings {
  return { projectDbConnections } as unknown as Settings
}

const api = {
  dbConnectionsList: vi.fn(),
  dbSchemas: vi.fn(),
  dbTables: vi.fn(),
  setSettings: vi.fn()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('window', { piwright: api })
  useSessionsStore.setState({ settings: seedSettings({ [PROJECT_KEY]: [connection] }) })
  useDbStore.setState({
    open: false,
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
    expandedSchemas: new Set()
  })
})

describe('db store', () => {
  it('load тянет подключения один раз, смена проекта перезагружает', async () => {
    api.dbConnectionsList.mockResolvedValue({ ok: true, error: null, connections: [connection] })
    await useDbStore.getState().load(PROJECT_KEY)
    await useDbStore.getState().load(PROJECT_KEY)
    expect(api.dbConnectionsList).toHaveBeenCalledTimes(1)
    expect(api.dbConnectionsList).toHaveBeenCalledWith(PROJECT_KEY)
    expect(useDbStore.getState().connections).toEqual([connection])
    expect(useDbStore.getState().connectionsLoaded).toBe(true)
    await useDbStore.getState().load('other\u0000key')
    expect(api.dbConnectionsList).toHaveBeenCalledTimes(2)
  })

  it('раскрытие подключения лениво грузит схемы, повторный клик — кэш', async () => {
    api.dbSchemas.mockResolvedValue({ ok: true, error: null, schemas: ['public', 'sales'] })
    await useDbStore.getState().load(PROJECT_KEY)
    useDbStore.getState().toggleConnection(connection.id)
    await vi.waitFor(() => expect(useDbStore.getState().schemasByConnection[connection.id]).toEqual(['public', 'sales']))
    useDbStore.getState().toggleConnection(connection.id)
    useDbStore.getState().toggleConnection(connection.id)
    expect(api.dbSchemas).toHaveBeenCalledTimes(1)
  })

  it('раскрытие схемы лениво грузит таблицы по ключу', async () => {
    api.dbTables.mockResolvedValue({ ok: true, error: null, tables: ['users'] })
    useDbStore.getState().toggleSchema(connection.id, 'public')
    await vi.waitFor(() => expect(useDbStore.getState().tablesBySchema[dbTablesKey(connection.id, 'public')]).toEqual(['users']))
    expect(api.dbTables).toHaveBeenCalledWith(connection.id, 'public')
  })

  it('чекбокс схемы пишет selectedSchemas и персистит патч в settings', async () => {
    api.dbSchemas.mockResolvedValue({ ok: true, error: null, schemas: ['public', 'sales'] })
    api.setSettings.mockImplementation(async (patch: Settings) => patch)
    await useDbStore.getState().load(PROJECT_KEY)
    useDbStore.getState().toggleConnection(connection.id)
    await vi.waitFor(() => expect(useDbStore.getState().schemasByConnection[connection.id]).toBeDefined())
    useDbStore.getState().setSelectedSchemas(connection.id, ['public'])
    expect(useDbStore.getState().connections[0].selectedSchemas).toEqual(['public'])
    await vi.waitFor(() => expect(api.setSettings).toHaveBeenCalledTimes(1))
    const patch = api.setSettings.mock.calls[0][0] as Settings
    expect(patch.projectDbConnections).toEqual({
      [PROJECT_KEY]: [{ ...connection, selectedSchemas: ['public'] }]
    })
  })

  it('ошибка загрузки схем попадает в error', async () => {
    api.dbSchemas.mockResolvedValue({ ok: false, error: 'connection refused', schemas: [] })
    useDbStore.getState().toggleConnection(connection.id)
    await vi.waitFor(() => expect(useDbStore.getState().error).toBe('connection refused'))
  })
})
