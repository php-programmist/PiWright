/** Сервис БД панели DB: соединения per connectionId (лениво, кэшируются до disconnect/dispose),
 *  драйверы pg/mysql2 за узким интерфейсом DbDriver, SSH-туннели через SshService.forwardOut.
 *  Секреты — DbSecretsStore (не settings.json). Все публичные методы — *Result-формы. */
import type { Duplex } from 'node:stream'
import pg from 'pg'
import { createConnection, type Connection as MysqlConnection, type ConnectionOptions as MysqlConnectionOptions } from 'mysql2/promise'
import type {
  DbColumn,
  DbConnectionEntry,
  DbQueryResult,
  DbSchemasResult,
  DbSecretInput,
  DbTableDataInput,
  DbTableDataResult,
  DbTableFilter,
  DbTableOrder,
  DbTablesResult,
  DbTestResult,
  DbOpResult,
  Settings,
  SshServerEntry
} from '../../shared/ipc-contracts'
import type { SshSecret } from '../ssh/secrets'
import type { SshService } from '../ssh/ssh-service'
import type { DbSecretsStore } from './db-secrets'

/** Таймаут count(*) — на больших таблицах дорог; по таймауту отдаём total = null (UI: «≥ N»). */
const COUNT_TIMEOUT_MS = 3000

export interface DbDriver {
  readonly kind: DbConnectionEntry['kind']
  version(): Promise<string>
  listSchemas(): Promise<string[]>
  listTables(schema: string): Promise<string[]>
  describeTable(schema: string, table: string): Promise<DbColumn[]>
  selectRows(schema: string, table: string, opts: { limit: number; offset: number; orderBy: DbTableOrder | null; filters: DbTableFilter[] }): Promise<{
    columns: DbColumn[]
    rows: unknown[][]
    total: number | null
  }>
  query(sql: string): Promise<Omit<DbQueryResult, 'ok' | 'error'>>
  close(): Promise<void>
}

/** Точка подмены в тестах: настоящая фабрика строит pg/mysql2-драйверы. */
export type DbDriverFactory = (entry: DbConnectionEntry, socket: Duplex | null, password: string | null) => Promise<DbDriver>

export function quotePgIdentifier(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"'
}

export function quoteMysqlIdentifier(name: string): string {
  return '`' + name.replace(/`/g, '``') + '`'
}

/** SELECT страницы + count(*): идентификаторы только через quote, значения фильтров — только параметрами. */
export function buildSelectSql(opts: {
  quote: (name: string) => string
  placeholder: (index: number) => string
  schema: string
  table: string
  limit: number
  offset: number
  orderBy: DbTableOrder | null
  filters: DbTableFilter[]
}): { sql: string; params: string[]; countSql: string; countParams: string[] } {
  const target = `${opts.quote(opts.schema)}.${opts.quote(opts.table)}`
  const params: string[] = []
  const clauses = opts.filters.map((filter) => {
    params.push(filter.value)
    return `${opts.quote(filter.column)} = ${opts.placeholder(params.length)}`
  })
  const whereSql = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : ''
  const orderSql = opts.orderBy !== null ? ` ORDER BY ${opts.quote(opts.orderBy.column)}${opts.orderBy.desc ? ' DESC' : ' ASC'}` : ''
  const sql = `SELECT * FROM ${target}${whereSql}${orderSql} LIMIT ${opts.limit} OFFSET ${opts.offset}`
  return { sql, params, countSql: `SELECT count(*) AS total FROM ${target}${whereSql}`, countParams: [...params] }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function rowsToArrays(rows: Record<string, unknown>[], columns: string[]): unknown[][] {
  return rows.map((row) => columns.map((column) => row[column] ?? null))
}

async function countWithTimeout(query: () => Promise<number>): Promise<number | null> {
  const work = query().catch(() => null)
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), COUNT_TIMEOUT_MS)
    timer.unref()
  })
  return await Promise.race([work, timeout])
}

/** Драйвер PostgreSQL: пул pg поверх прямого сокета или SSH-туннеля (опция stream). */
export class PgDriver implements DbDriver {
  readonly kind = 'postgres' as const
  private readonly pool: pg.Pool

  constructor(config: pg.ClientConfig, socket: Duplex | null = null) {
    const poolConfig: pg.PoolConfig = { ...config, max: 4 }
    if (socket !== null) (poolConfig as Record<string, unknown>)['stream'] = socket
    this.pool = new pg.Pool(poolConfig)
    // Ошибка idle-клиента не должна ронять процесс — соединение вымется из пула само.
    this.pool.on('error', () => {})
  }

  async version(): Promise<string> {
    const result = await this.pool.query<{ v: string }>('SELECT version() AS v')
    return result.rows[0]?.v ?? ''
  }

  async listSchemas(): Promise<string[]> {
    const result = await this.pool.query<{ name: string }>(
      "SELECT schema_name AS name FROM information_schema.schemata WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast') ORDER BY name"
    )
    return result.rows.map((row) => row.name)
  }

  async listTables(schema: string): Promise<string[]> {
    const result = await this.pool.query<{ name: string }>(
      "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY name",
      [schema]
    )
    return result.rows.map((row) => row.name)
  }

  async describeTable(schema: string, table: string): Promise<DbColumn[]> {
    const result = await this.pool.query<{ name: string; type: string }>(
      'SELECT column_name AS name, data_type AS type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position',
      [schema, table]
    )
    return result.rows.map((row) => ({ name: row.name, type: row.type }))
  }

  async selectRows(schema: string, table: string, opts: { limit: number; offset: number; orderBy: DbTableOrder | null; filters: DbTableFilter[] }): Promise<{
    columns: DbColumn[]
    rows: unknown[][]
    total: number | null
  }> {
    const built = buildSelectSql({ ...opts, schema, table, quote: quotePgIdentifier, placeholder: (index) => `$${index}` })
    const result = await this.pool.query(built.sql, built.params)
    const columns = result.fields.map((field) => ({ name: field.name, type: null }))
    const total = await countWithTimeout(async () => {
      const count = await this.pool.query<{ total: string }>(built.countSql, built.countParams)
      return Number(count.rows[0]?.total ?? 0)
    })
    return { columns, rows: rowsToArrays(result.rows as Record<string, unknown>[], columns.map((c) => c.name)), total }
  }

  async query(sql: string): Promise<Omit<DbQueryResult, 'ok' | 'error'>> {
    const result = await this.pool.query(sql)
    const isSelect = result.command === 'SELECT' || result.command === 'SHOW' || result.command === 'EXPLAIN'
    if (!isSelect) {
      return { columns: [], rows: [], rowsAffected: result.rowCount ?? null, isSelect: false }
    }
    const columns = result.fields.map((field) => ({ name: field.name, type: null }))
    return {
      columns,
      rows: rowsToArrays(result.rows as Record<string, unknown>[], columns.map((c) => c.name)),
      rowsAffected: result.rowCount ?? null,
      isSelect: true
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}

/** Драйвер MySQL: одно соединение mysql2 (протокол сам ставит запросы в очередь),
 *  прямое или через SSH-туннель (опция stream createConnection); обрыв — переподключение. */
export class MysqlDriver implements DbDriver {
  readonly kind = 'mysql' as const
  private connection: MysqlConnection | null = null
  private connecting: Promise<MysqlConnection> | null = null

  constructor(private readonly config: MysqlConnectionOptions) {}

  private async conn(): Promise<MysqlConnection> {
    if (this.connection !== null) return this.connection
    if (this.connecting !== null) return this.connecting
    this.connecting = createConnection(this.config).then((conn) => {
      conn.on('error', () => {
        if (this.connection === conn) this.connection = null
      })
      this.connection = conn
      this.connecting = null
      return conn
    })
    this.connecting.catch(() => {
      this.connecting = null
    })
    return this.connecting
  }

  private drop(conn: MysqlConnection): void {
    if (this.connection === conn) this.connection = null
  }

  async version(): Promise<string> {
    const conn = await this.conn()
    try {
      const [rows] = await conn.query('SELECT VERSION() AS v')
      return (rows as Record<string, unknown>[])[0]?.v !== undefined ? String((rows as Record<string, unknown>[])[0]['v']) : ''
    } catch (err) {
      this.drop(conn)
      throw err
    }
  }

  async listSchemas(): Promise<string[]> {
    const conn = await this.conn()
    try {
      const [rows] = await conn.query(
        "SELECT schema_name AS name FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys') ORDER BY name"
      )
      return (rows as Record<string, unknown>[]).map((row) => String(row['name']))
    } catch (err) {
      this.drop(conn)
      throw err
    }
  }

  async listTables(schema: string): Promise<string[]> {
    const conn = await this.conn()
    try {
      const [rows] = await conn.query(
        "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE' ORDER BY name",
        [schema]
      )
      return (rows as Record<string, unknown>[]).map((row) => String(row['name']))
    } catch (err) {
      this.drop(conn)
      throw err
    }
  }

  async describeTable(schema: string, table: string): Promise<DbColumn[]> {
    const conn = await this.conn()
    try {
      const [rows] = await conn.query(
        'SELECT column_name AS name, data_type AS type FROM information_schema.columns WHERE table_schema = ? AND table_name = ? ORDER BY ordinal_position',
        [schema, table]
      )
      return (rows as Record<string, unknown>[]).map((row) => ({ name: String(row['name']), type: String(row['type']) }))
    } catch (err) {
      this.drop(conn)
      throw err
    }
  }

  async selectRows(schema: string, table: string, opts: { limit: number; offset: number; orderBy: DbTableOrder | null; filters: DbTableFilter[] }): Promise<{
    columns: DbColumn[]
    rows: unknown[][]
    total: number | null
  }> {
    const conn = await this.conn()
    const built = buildSelectSql({ ...opts, schema, table, quote: quoteMysqlIdentifier, placeholder: () => '?' })
    try {
      const [rows, fields] = await conn.query(built.sql, built.params)
      const columns = (fields ?? []).map((field) => ({ name: field.name, type: null }))
      const total = await countWithTimeout(async () => {
        const [countRows] = await conn.query(built.countSql, built.countParams)
        return Number((countRows as Record<string, unknown>[])[0]?.['total'] ?? 0)
      })
      return { columns, rows: rowsToArrays(rows as Record<string, unknown>[], columns.map((c) => c.name)), total }
    } catch (err) {
      this.drop(conn)
      throw err
    }
  }

  async query(sql: string): Promise<Omit<DbQueryResult, 'ok' | 'error'>> {
    const conn = await this.conn()
    try {
      const [rows, fields] = await conn.query({ sql })
      if (Array.isArray(rows) && fields !== undefined) {
        const columns = fields.map((field) => ({ name: field.name, type: null }))
        return {
          columns,
          rows: rowsToArrays(rows as Record<string, unknown>[], columns.map((c) => c.name)),
          rowsAffected: null,
          isSelect: true
        }
      }
      const header = rows as { affectedRows?: number }
      return { columns: [], rows: [], rowsAffected: header.affectedRows ?? null, isSelect: false }
    } catch (err) {
      this.drop(conn)
      throw err
    }
  }

  async close(): Promise<void> {
    const conn = this.connection
    this.connection = null
    if (conn !== null) conn.destroy()
  }
}

/** Настоящая фабрика драйверов: конфиг из entry + пароль + опциональный туннельный сокет. */
export const defaultDriverFactory: DbDriverFactory = async (entry, socket, password) => {
  if (entry.kind === 'postgres') {
    const config: pg.ClientConfig = {
      host: entry.host,
      port: entry.port,
      database: entry.database,
      user: entry.user,
      connectionTimeoutMillis: 10_000
    }
    if (password !== null) config.password = password
    return new PgDriver(config, socket)
  }
  const config: MysqlConnectionOptions = {
    host: entry.host,
    port: entry.port,
    database: entry.database,
    user: entry.user,
    connectTimeout: 10_000
  }
  if (password !== null) config.password = password
  if (socket !== null) (config as Record<string, unknown>)['stream'] = socket
  return new MysqlDriver(config)
}

/** Сервис подключений БД: кэш драйверов per connectionId, туннели, секреты. */
export class DbService {
  private readonly drivers = new Map<string, Promise<DbDriver>>()

  constructor(
    private readonly getSettings: () => Settings,
    private readonly secrets: DbSecretsStore,
    private readonly ssh: SshService,
    private readonly factory: DbDriverFactory = defaultDriverFactory
  ) {}

  private entry(connectionId: string): DbConnectionEntry {
    const entry = this.getSettings().dbConnections.find((c) => c.id === connectionId)
    if (entry === undefined) throw new Error(`Unknown DB connection: ${connectionId}`)
    return entry
  }

  /** Открыть драйвер: пароль из черновика или хранилища; ssh-туннель — direct-tcpip поток. */
  private async openDriver(entry: DbConnectionEntry, draft: DbSecretInput | null): Promise<DbDriver> {
    const stored = this.secrets.get(entry.id)
    const password = entry.authType === 'none' ? null : (draft?.password ?? stored.password ?? null)
    let socket: Duplex | null = null
    const tunnel = entry.ssh
    if (tunnel !== null && tunnel !== undefined) {
      const server: SshServerEntry = { id: entry.id, name: entry.name, host: tunnel.host, port: tunnel.port, user: tunnel.user, auth: tunnel.auth }
      if (tunnel.keyPath !== undefined) server.keyPath = tunnel.keyPath
      const sshSecret: SshSecret = {}
      const sshPassword = draft?.sshPassword ?? stored.sshPassword
      if (sshPassword !== undefined) sshSecret.password = sshPassword
      const sshPassphrase = draft?.sshKeyPassphrase ?? stored.sshKeyPassphrase
      if (sshPassphrase !== undefined) sshSecret.keyPassphrase = sshPassphrase
      socket = await this.ssh.forwardOut(server, entry.host, entry.port, sshSecret)
    }
    return await this.factory(entry, socket, password)
  }

  /** Драйвер подключения; черновик секретов (test) — всегда новое соединение. Упавший кэш вымывается. */
  private driverFor(entry: DbConnectionEntry, draft: DbSecretInput | null): Promise<DbDriver> {
    if (draft !== null) return this.openDriver(entry, draft)
    const existing = this.drivers.get(entry.id)
    if (existing !== undefined) return existing
    const created = this.openDriver(entry, null).catch((err) => {
      this.drivers.delete(entry.id)
      throw err
    })
    this.drivers.set(entry.id, created)
    return created
  }

  async test(entry: DbConnectionEntry, draft?: DbSecretInput | null): Promise<DbTestResult> {
    let driver: DbDriver | null = null
    try {
      driver = await this.openDriver(entry, draft ?? null)
      return { ok: true, error: null, serverVersion: await driver.version() }
    } catch (err) {
      return { ok: false, error: errorMessage(err), serverVersion: null }
    } finally {
      if (driver !== null) {
        try {
          await driver.close()
        } catch {
          // соединение могло не открыться
        }
      }
    }
  }

  async schemas(connectionId: string): Promise<DbSchemasResult> {
    try {
      const driver = await this.driverFor(this.entry(connectionId), null)
      return { ok: true, error: null, schemas: await driver.listSchemas() }
    } catch (err) {
      return { ok: false, error: errorMessage(err), schemas: [] }
    }
  }

  async tables(connectionId: string, schema: string): Promise<DbTablesResult> {
    try {
      const driver = await this.driverFor(this.entry(connectionId), null)
      return { ok: true, error: null, tables: await driver.listTables(schema) }
    } catch (err) {
      return { ok: false, error: errorMessage(err), tables: [] }
    }
  }

  async tableData(input: DbTableDataInput): Promise<DbTableDataResult> {
    try {
      const driver = await this.driverFor(this.entry(input.connectionId), null)
      const result = await driver.selectRows(input.schema, input.table, {
        limit: input.limit,
        offset: input.offset,
        orderBy: input.orderBy ?? null,
        filters: input.filters ?? []
      })
      return { ok: true, error: null, columns: result.columns, rows: result.rows, total: result.total }
    } catch (err) {
      return { ok: false, error: errorMessage(err), columns: [], rows: [], total: null }
    }
  }

  async query(connectionId: string, sql: string): Promise<DbQueryResult> {
    try {
      const driver = await this.driverFor(this.entry(connectionId), null)
      return { ok: true, error: null, ...(await driver.query(sql)) }
    } catch (err) {
      return { ok: false, error: errorMessage(err), columns: [], rows: [], rowsAffected: null, isSelect: false }
    }
  }

  /** Закрыть и выкинуть драйвер подключения (правка конфига, ручной disconnect). */
  async disconnect(connectionId: string): Promise<DbOpResult> {
    const pending = this.drivers.get(connectionId)
    this.drivers.delete(connectionId)
    if (pending !== undefined) {
      try {
        const driver = await pending
        await driver.close()
      } catch {
        // драйвер мог упасть ещё при открытии
      }
    }
    return { ok: true, error: null }
  }

  setSecrets(connectionId: string, patch: { password?: string | null; sshPassword?: string | null; sshKeyPassphrase?: string | null }): void {
    this.secrets.set(connectionId, patch)
  }

  deleteSecrets(connectionId: string): void {
    this.secrets.remove(connectionId)
  }

  /** id подключений, чьи секреты остались без записи в settings (для очистки). */
  removedConnectionIds(known: Set<string>): string[] {
    return this.secrets.ids().filter((id) => !known.has(id))
  }

  async disposeAll(): Promise<void> {
    const pending = [...this.drivers.values()]
    this.drivers.clear()
    await Promise.allSettled(
      pending.map(async (promise) => {
        const driver = await promise
        await driver.close()
      })
    )
  }
}
