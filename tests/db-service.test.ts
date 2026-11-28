/** DbService на фейковых драйверах: кэш per connectionId, test/disconnect/disposeAll,
 *  разрешение секретов (draft/хранилище/none), SSH-туннель (аргументы forwardOut),
 *  сборка SQL (quoteIdentifier, фильтры-параметры, order/limit/offset, count). */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { createServer, connect as netConnect, type Server as NetServer, type Socket as NetSocket } from 'node:net'
import { Duplex } from 'node:stream'
import { afterAll, describe, expect, it } from 'vitest'
import { DbSecretsService } from '../src/main/db/db-secrets'
import { buildChangeStatements, buildSelectSql, DbService, PgDriver, quoteMysqlIdentifier, quotePgIdentifier, type DbDriver, type DbDriverFactory } from '../src/main/db/db-service'
import { DEFAULT_SETTINGS } from '../src/main/settings/settings'
import type { SshService } from '../src/main/ssh/ssh-service'
import type { SshSecret } from '../src/main/ssh/secrets'
import type { DbConnectionEntry, DbSecretInput, Settings, SshServerEntry } from '../src/shared/ipc-contracts'

const dirs: string[] = []

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function makeSecrets(): DbSecretsService {
  const dir = mkdtempSync(join(tmpdir(), 'piwright-db-service-'))
  dirs.push(dir)
  return new DbSecretsService(
    join(dir, 'db-secrets.json'),
    (value) => Buffer.from(value, 'utf8'),
    (buffer) => buffer.toString('utf8')
  )
}

const pgEntry: DbConnectionEntry = { id: 'pg1', name: 'PG', kind: 'postgres', host: 'db', port: 5432, database: 'app', user: 'u', authType: 'password' }
const mysqlEntry: DbConnectionEntry = { id: 'my1', name: 'MY', kind: 'mysql', host: 'db', port: 3306, database: 'app', user: 'u', authType: 'password' }

function settingsWith(entries: DbConnectionEntry[]): () => Settings {
  return () => ({ ...DEFAULT_SETTINGS, projectDbConnections: { 'native\u0000C:\\proj': entries } })
}

interface FakeDriverState {
  created: number
  closed: number
  sockets: (Duplex | null)[]
  passwords: (string | null)[]
}

function makeFakeFactory(state: FakeDriverState): DbDriverFactory {
  return async (_entry, socket, password) => {
    state.created += 1
    state.sockets.push(socket)
    state.passwords.push(password)
    const driver: DbDriver = {
      kind: 'postgres',
      version: async () => 'PostgreSQL 16 (fake)',
      listSchemas: async () => ['public'],
      listTables: async () => ['users'],
      describeTable: async () => [{ name: 'id', type: 'integer' }],
      primaryKeys: async () => ['id'],
      executeTransaction: async () => 0,
      selectRows: async () => ({ columns: [{ name: 'id', type: null }], rows: [[1]], total: 1 }),
      query: async () => ({ columns: [], rows: [], rowsAffected: 1, isSelect: false }),
      close: async () => {
        state.closed += 1
      }
    }
    return driver
  }
}

interface FakeSshState {
  calls: { server: SshServerEntry; dstHost: string; dstPort: number; secret: SshSecret }[]
  socket: Duplex
  error: Error | null
}

function makeFakeSsh(state: FakeSshState): SshService {
  return {
    forwardOut: async (server: SshServerEntry, dstHost: string, dstPort: number, secret?: SshSecret | null) => {
      if (state.error !== null) throw state.error
      state.calls.push({ server, dstHost, dstPort, secret: secret ?? {} })
      return state.socket
    }
  } as unknown as SshService
}

function makeService(entries: DbConnectionEntry[], factory: DbDriverFactory, ssh?: SshService): { db: DbService; secrets: DbSecretsService } {
  const secrets = makeSecrets()
  const db = new DbService(settingsWith(entries), secrets, ssh ?? makeFakeSsh({ calls: [], socket: new Duplex(), error: null }), factory)
  return { db, secrets }
}

describe('DbService (fake drivers)', () => {
  it('driver cached per connectionId, reused across calls', async () => {
    const state: FakeDriverState = { created: 0, closed: 0, sockets: [], passwords: [] }
    const { db } = makeService([pgEntry], makeFakeFactory(state))
    const first = await db.schemas('pg1')
    const second = await db.schemas('pg1')
    expect(first.ok).toBe(true)
    expect(second.schemas).toEqual(['public'])
    expect(state.created).toBe(1)
    expect(state.closed).toBe(0)
  })

  it('unknown connection id errors', async () => {
    const { db } = makeService([pgEntry], makeFakeFactory({ created: 0, closed: 0, sockets: [], passwords: [] }))
    const result = await db.schemas('nope')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Unknown DB connection')
  })

  it('test uses draft secrets, closes driver, does not cache', async () => {
    const state: FakeDriverState = { created: 0, closed: 0, sockets: [], passwords: [] }
    const { db } = makeService([pgEntry], makeFakeFactory(state))
    const draft: DbSecretInput = { password: 'draft-pass' }
    const result = await db.test(pgEntry, draft)
    expect(result).toEqual({ ok: true, error: null, serverVersion: 'PostgreSQL 16 (fake)' })
    expect(state.passwords[0]).toBe('draft-pass')
    expect(state.closed).toBe(1)
    expect(state.created).toBe(1)
    await db.schemas('pg1')
    expect(state.created).toBe(2)
  })

  it('test failure returns error result', async () => {
    const failing: DbDriverFactory = async () => {
      throw new Error('connection refused')
    }
    const { db } = makeService([pgEntry], failing)
    const result = await db.test(pgEntry, null)
    expect(result.ok).toBe(false)
    expect(result.error).toBe('connection refused')
  })

  it('password: none from store, draft overrides, authType none disables', async () => {
    const state: FakeDriverState = { created: 0, closed: 0, sockets: [], passwords: [] }
    const { db, secrets } = makeService([pgEntry, mysqlEntry], makeFakeFactory(state))
    secrets.set('pg1', { password: 'stored-pass' })
    await db.schemas('pg1')
    expect(state.passwords[0]).toBe('stored-pass')
    await db.test(mysqlEntry, { password: 'draft-pass' })
    expect(state.passwords[1]).toBe('draft-pass')
    const noAuth: DbConnectionEntry = { ...pgEntry, id: 'open1', authType: 'none' }
    await db.test(noAuth, null)
    expect(state.passwords[2]).toBeNull()
  })

  it('ssh tunnel: forwardOut called with tunnel config + stored ssh secret, socket passed to factory', async () => {
    const sshState: FakeSshState = { calls: [], socket: new Duplex(), error: null }
    const ssh = makeFakeSsh(sshState)
    const state: FakeDriverState = { created: 0, closed: 0, sockets: [], passwords: [] }
    const { db, secrets } = makeService(
      [{ ...pgEntry, ssh: { host: 'bastion', port: 2222, user: 'jump', auth: 'password', keyPath: '/keys/id_rsa' } }],
      makeFakeFactory(state),
      ssh
    )
    secrets.set('pg1', { password: 'db-pass', sshPassword: 'ssh-pass' })
    await db.schemas('pg1')
    expect(sshState.calls.length).toBe(1)
    expect(sshState.calls[0].server).toEqual({ id: 'pg1', name: 'PG', host: 'bastion', port: 2222, user: 'jump', auth: 'password', keyPath: '/keys/id_rsa' })
    expect(sshState.calls[0].dstHost).toBe('db')
    expect(sshState.calls[0].dstPort).toBe(5432)
    expect(sshState.calls[0].secret).toEqual({ password: 'ssh-pass' })
    expect(state.sockets[0]).toBe(sshState.socket)
    expect(state.passwords[0]).toBe('db-pass')
  })

  it('tunnel draft secrets override stored', async () => {
    const sshState: FakeSshState = { calls: [], socket: new Duplex(), error: null }
    const ssh = makeFakeSsh(sshState)
    const state: FakeDriverState = { created: 0, closed: 0, sockets: [], passwords: [] }
    const { db, secrets } = makeService([{ ...pgEntry, ssh: { host: 'b', port: 22, user: 'j', auth: 'password' } }], makeFakeFactory(state), ssh)
    secrets.set('pg1', { sshPassword: 'old' })
    await db.test({ ...pgEntry, ssh: { host: 'b', port: 22, user: 'j', auth: 'password' } }, { sshPassword: 'new' })
    expect(sshState.calls[0].secret).toEqual({ password: 'new' })
  })

  it('failed open evicts cache, next call retries', async () => {
    let fail = true
    const factory: DbDriverFactory = async () => {
      if (fail) throw new Error('down')
      return makeFakeFactory({ created: 0, closed: 0, sockets: [], passwords: [] })(pgEntry, null, null)
    }
    const { db } = makeService([pgEntry], factory)
    const first = await db.schemas('pg1')
    expect(first.ok).toBe(false)
    fail = false
    const second = await db.schemas('pg1')
    expect(second.ok).toBe(true)
  })

  it('connection-level query error evicts cached driver, next call opens fresh', async () => {
    let fail: Error | null = new Error('timeout expired')
    let created = 0
    let closed = 0
    const factory: DbDriverFactory = async () => {
      created += 1
      return {
        kind: 'postgres',
        version: async () => 'v',
        listSchemas: async () => ['public'],
        listTables: async () => {
          if (fail !== null) throw fail
          return ['users']
        },
        describeTable: async () => [],
        primaryKeys: async () => [],
        executeTransaction: async () => 0,
        selectRows: async () => ({ columns: [], rows: [], total: null }),
        query: async () => ({ columns: [], rows: [], rowsAffected: null, isSelect: false }),
        close: async () => {
          closed += 1
        }
      }
    }
    const { db } = makeService([pgEntry], factory)
    const first = await db.tables('pg1', 'public')
    expect(first.ok).toBe(false)
    expect(created).toBe(1)
    // Драйвер вымыт: close вызван без ожидания, ждём его и повторного открытия.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(closed).toBe(1)
    fail = null
    const second = await db.tables('pg1', 'public')
    expect(second.ok).toBe(true)
    expect(created).toBe(2)
  })

  it('server-side SQL error (pg 5-digit code) keeps cached driver', async () => {
    let created = 0
    let closed = 0
    const factory: DbDriverFactory = async () => {
      created += 1
      return {
        kind: 'postgres',
        version: async () => 'v',
        listSchemas: async () => ['public'],
        listTables: async () => {
          throw Object.assign(new Error('syntax error'), { code: '42601' })
        },
        describeTable: async () => [],
        primaryKeys: async () => [],
        executeTransaction: async () => 0,
        selectRows: async () => ({ columns: [], rows: [], total: null }),
        query: async () => ({ columns: [], rows: [], rowsAffected: null, isSelect: false }),
        close: async () => {
          closed += 1
        }
      }
    }
    const { db } = makeService([pgEntry], factory)
    const first = await db.tables('pg1', 'public')
    expect(first.ok).toBe(false)
    const second = await db.tables('pg1', 'public')
    expect(second.ok).toBe(false)
    expect(created).toBe(1)
    expect(closed).toBe(0)
  })

  it('mysql: server error (errno+sqlState) keeps driver, protocol error evicts', async () => {
    let mode: 'server' | 'protocol' = 'server'
    let created = 0
    let closed = 0
    const factory: DbDriverFactory = async () => {
      created += 1
      return {
        kind: 'mysql',
        version: async () => 'v',
        listSchemas: async () => ['shop'],
        listTables: async () => ['items'],
        describeTable: async () => [],
        primaryKeys: async () => [],
        executeTransaction: async () => 0,
        selectRows: async () => ({ columns: [], rows: [], total: null }),
        query: async () => {
          if (mode === 'server') throw Object.assign(new Error('no such table'), { errno: 1146, sqlState: '42S02' })
          throw new Error('PROTOCOL_CONNECTION_LOST')
        },
        close: async () => {
          closed += 1
        }
      }
    }
    const { db } = makeService([mysqlEntry], factory)
    expect((await db.query('my1', 'SELECT 1')).ok).toBe(false)
    expect((await db.query('my1', 'SELECT 1')).ok).toBe(false)
    expect(created).toBe(1)
    expect(closed).toBe(0)
    mode = 'protocol'
    expect((await db.query('my1', 'SELECT 1')).ok).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(closed).toBe(1)
    expect((await db.query('my1', 'SELECT 1')).ok).toBe(false)
    expect(created).toBe(2)
  })

  it('disconnect closes driver and evicts; disposeAll closes all', async () => {
    const state: FakeDriverState = { created: 0, closed: 0, sockets: [], passwords: [] }
    const { db } = makeService([pgEntry, mysqlEntry], makeFakeFactory(state))
    await db.schemas('pg1')
    await db.schemas('my1')
    expect(state.created).toBe(2)
    await db.disconnect('pg1')
    expect(state.closed).toBe(1)
    await db.schemas('pg1')
    expect(state.created).toBe(3)
    await db.disposeAll()
    expect(state.closed).toBe(3)
    await db.disposeAll()
    expect(state.closed).toBe(3)
  })

  it('removedConnectionIds lists orphans', async () => {
    const { db, secrets } = makeService([pgEntry], makeFakeFactory({ created: 0, closed: 0, sockets: [], passwords: [] }))
    secrets.set('pg1', { password: 'p' })
    secrets.set('ghost', { password: 'q' })
    expect(db.removedConnectionIds(new Set(['pg1']))).toEqual(['ghost'])
  })
})

describe('SQL builders', () => {
  it('pg identifier quoting doubles embedded quotes', () => {
    expect(quotePgIdentifier('users')).toBe('"users"')
    expect(quotePgIdentifier('we"ird')).toBe('"we""ird"')
  })

  it('mysql identifier quoting doubles backticks', () => {
    expect(quoteMysqlIdentifier('users')).toBe('`users`')
    expect(quoteMysqlIdentifier('we`ird')).toBe('`we``ird`')
  })

  it('pg select: $n placeholders, order, limit/offset, count sql', () => {
    const built = buildSelectSql({
      quote: quotePgIdentifier,
      placeholder: (i) => `$${i}`,
      schema: 'public',
      table: 'users',
      limit: 50,
      offset: 100,
      orderBy: { column: 'name', desc: true },
      filters: [
        { column: 'a', value: '1' },
        { column: 'b', value: "x'; DROP TABLE users;--" }
      ]
    })
    expect(built.sql).toBe('SELECT * FROM "public"."users" WHERE "a" = $1 AND "b" = $2 ORDER BY "name" DESC LIMIT 50 OFFSET 100')
    expect(built.params).toEqual(['1', "x'; DROP TABLE users;--"])
    expect(built.countSql).toBe('SELECT count(*) AS total FROM "public"."users" WHERE "a" = $1 AND "b" = $2')
    expect(built.countParams).toEqual(['1', "x'; DROP TABLE users;--"])
  })

  it('mysql select: ? placeholders, asc order, no filters', () => {
    const built = buildSelectSql({
      quote: quoteMysqlIdentifier,
      placeholder: () => '?',
      schema: 'shop',
      table: 'items',
      limit: 10,
      offset: 0,
      orderBy: { column: 'id', desc: false },
      filters: []
    })
    expect(built.sql).toBe('SELECT * FROM `shop`.`items` ORDER BY `id` ASC LIMIT 10 OFFSET 0')
    expect(built.params).toEqual([])
    expect(built.countSql).toBe('SELECT count(*) AS total FROM `shop`.`items`')
  })

  it('change statements: update by pk, insert, delete by pk (pg literals)', () => {
    const statements = buildChangeStatements({
      kind: 'postgres',
      quote: quotePgIdentifier,
      schema: 'public',
      table: 'users',
      primaryKeys: ['id'],
      changes: [
        { kind: 'update', keys: { id: '1' }, values: { name: "O'Brien", age: '30' } },
        { kind: 'insert', keys: {}, values: { id: '2', name: null } },
        { kind: 'delete', keys: { id: '3' }, values: {} }
      ]
    })
    expect(statements).toEqual([
      `UPDATE "public"."users" SET "name" = 'O''Brien', "age" = '30' WHERE "id" = '1'`,
      'INSERT INTO "public"."users" ("id", "name") VALUES (\'2\', NULL)',
      'DELETE FROM "public"."users" WHERE "id" = \'3\''
    ])
  })

  it('change statements: mysql doubles backslashes in literals, composite pk where', () => {
    const statements = buildChangeStatements({
      kind: 'mysql',
      quote: quoteMysqlIdentifier,
      schema: 'shop',
      table: 'items',
      primaryKeys: ['a', 'b'],
      changes: [{ kind: 'update', keys: { a: '1', b: 'x\\y' }, values: { c: "it's" } }]
    })
    expect(statements).toEqual(["UPDATE `shop`.`items` SET `c` = 'it''s' WHERE `a` = '1' AND `b` = 'x\\\\y'"])
  })

  it('submit runs changes in one transaction; no pk rejected', async () => {
    const executed: string[][] = []
    const factory: DbDriverFactory = async () => ({
      kind: 'postgres',
      version: async () => 'v',
      listSchemas: async () => ['public'],
      listTables: async () => ['users'],
      describeTable: async () => [],
      primaryKeys: async () => ['id'],
      executeTransaction: async (statements) => {
        executed.push(statements)
        return statements.length
      },
      selectRows: async () => ({ columns: [{ name: 'id', type: null }], rows: [[1]], total: 1 }),
      query: async () => ({ columns: [], rows: [], rowsAffected: null, isSelect: false }),
      close: async () => {}
    })
    const { db } = makeService([pgEntry], factory)
    const input = {
      connectionId: 'pg1',
      schema: 'public',
      table: 'users',
      primaryKeys: ['id'],
      changes: [{ kind: 'update' as const, keys: { id: '1' }, values: { name: 'x' } }]
    }
    const result = await db.submit(input)
    expect(result.ok).toBe(true)
    expect(result.rowsAffected).toBe(1)
    expect(executed).toEqual([['UPDATE "public"."users" SET "name" = \'x\' WHERE "id" = \'1\'']])
    const noPk = await db.submit({ ...input, primaryKeys: [] })
    expect(noPk.ok).toBe(false)
    expect(executed.length).toBe(1)
    const preview = db.submitPreview(input)
    expect(preview.ok).toBe(true)
    expect(preview.statements).toEqual(['UPDATE "public"."users" SET "name" = \'x\' WHERE "id" = \'1\''])
    expect(db.submitPreview({ ...input, primaryKeys: [] }).ok).toBe(false)
  })

  it('tableData returns primaryKeys from driver', async () => {
    const factory: DbDriverFactory = async () => ({
      kind: 'postgres',
      version: async () => 'v',
      listSchemas: async () => ['public'],
      listTables: async () => ['users'],
      describeTable: async () => [],
      primaryKeys: async () => ['id'],
      executeTransaction: async () => 0,
      selectRows: async () => ({ columns: [{ name: 'id', type: null }], rows: [[1]], total: 1 }),
      query: async () => ({ columns: [], rows: [], rowsAffected: null, isSelect: false }),
      close: async () => {}
    })
    const { db } = makeService([pgEntry], factory)
    const result = await db.tableData({ connectionId: 'pg1', schema: 'public', table: 'users', limit: 10, offset: 0 })
    expect(result.ok).toBe(true)
    expect(result.primaryKeys).toEqual(['id'])
  })
})

/** Минимальный fake pg-сервер: startup → AuthOk+ReadyForQuery, 'Q' → CommandComplete+ReadyForQuery. */
function pgFrame(type: string, payload: Buffer): Buffer {
  const head = Buffer.alloc(5)
  head.write(type, 0)
  head.writeUInt32BE(4 + payload.length, 1)
  return Buffer.concat([head, payload])
}

const PG_AUTH_OK = pgFrame('R', Buffer.from([0, 0, 0, 0]))
const PG_READY = pgFrame('Z', Buffer.from('I'))

function serveFakePg(socket: NetSocket): void {
  let buffer = Buffer.alloc(0)
  let started = false
  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])
    for (;;) {
      if (!started) {
        // Startup-пакет: [int32 len][payload], len включает себя самого — весь кадр = len байт.
        if (buffer.length < 4) return
        const len = buffer.readUInt32BE(0)
        if (buffer.length < len) return
        buffer = buffer.subarray(len)
        started = true
        socket.write(PG_AUTH_OK)
        socket.write(PG_READY)
        continue
      }
      if (buffer.length < 5) return
      const len = buffer.readUInt32BE(1)
      if (buffer.length < 1 + len) return
      const type = buffer[0]
      buffer = buffer.subarray(1 + len)
      if (type === 0x51) {
        socket.write(pgFrame('C', Buffer.from('SELECT 1\x00')))
        socket.write(PG_READY)
      }
    }
  })
}

function listenFakePg(): Promise<NetServer> {
  return new Promise((resolve) => {
    const server = createServer((socket) => serveFakePg(socket))
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

function portOf(server: NetServer): number {
  const addr = server.address()
  return typeof addr === 'object' && addr !== null ? addr.port : 0
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

describe('PgDriver pool config', () => {
  /** ssh2-подобный канал поверх TCP: без setNoDelay/connect, не эмитит 'connect' —
   *  как direct-tcpip канал forwardOut (под preparePgTunnelStream). */
  function channelOver(upstream: NetSocket): Duplex {
    // Голый Duplex как ssh2 Channel: без setNoDelay/connect/ref/unref, не эмитит 'connect'.
    const channel = new Duplex({
      read() {},
      write(chunk: Buffer, _enc, cb) {
        upstream.write(chunk)
        cb()
      }
    })
    upstream.on('data', (chunk: Buffer) => channel.push(chunk))
    upstream.on('close', () => channel.destroy())
    upstream.on('error', () => channel.destroy())
    return channel
  }

  it('tunnel pool: idle client not removed (idleTimeoutMillis forced to 0) — shared channel survives idle', async () => {
    const server = await listenFakePg()
    try {
      const tcp = netConnect({ host: '127.0.0.1', port: portOf(server) })
      tcp.on('error', () => {})
      await once(tcp, 'connect')
      const driver = new PgDriver({ host: '127.0.0.1', port: portOf(server), connectionTimeoutMillis: 5000, idleTimeoutMillis: 30 }, channelOver(tcp))
      const first = await driver.query('SELECT 1')
      expect(first.isSelect).toBe(true)
      await sleep(120)
      // Канал жив: второй запрос уходит по тому же стриму (с дефолтом 10с клиент был бы вымет и канал закрыт)
      const second = await driver.query('SELECT 2')
      expect(second.isSelect).toBe(true)
      await driver.close()
      tcp.destroy()
    } finally {
      server.close()
    }
  })

  it('direct pool honors idleTimeoutMillis: idle client removed, connection closed (mechanism)', async () => {
    const server = await listenFakePg()
    const closed = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('idle client was not removed')), 3000)
      timer.unref()
      server.on('connection', (socket: NetSocket) => {
        socket.on('close', () => {
          clearTimeout(timer)
          resolve()
        })
      })
    })
    try {
      const driver = new PgDriver({ host: '127.0.0.1', port: portOf(server), connectionTimeoutMillis: 5000, idleTimeoutMillis: 30 }, null)
      const result = await driver.query('SELECT 1')
      expect(result.isSelect).toBe(true)
      await closed
      await driver.close()
    } finally {
      server.close()
    }
  })
})
