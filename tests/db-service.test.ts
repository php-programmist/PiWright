/** DbService на фейковых драйверах: кэш per connectionId, test/disconnect/disposeAll,
 *  разрешение секретов (draft/хранилище/none), SSH-туннель (аргументы forwardOut),
 *  сборка SQL (quoteIdentifier, фильтры-параметры, order/limit/offset, count). */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Duplex } from 'node:stream'
import { afterAll, describe, expect, it } from 'vitest'
import { DbSecretsService } from '../src/main/db/db-secrets'
import { buildSelectSql, DbService, errorMessage, quoteMysqlIdentifier, quotePgIdentifier, type DbDriver, type DbDriverFactory } from '../src/main/db/db-service'
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

describe('errorMessage', () => {
  it('AggregateError (multi-address connect): joins inner messages, message is empty', () => {
    const err = new AggregateError([new Error('connect ECONNREFUSED 127.0.0.1:5435'), new Error('connect ECONNREFUSED ::1:5435')])
    expect(err.message).toBe('')
    expect(errorMessage(err)).toBe('connect ECONNREFUSED 127.0.0.1:5435; connect ECONNREFUSED ::1:5435')
  })

  it('AggregateError: dedupes identical inner messages, skips empty ones', () => {
    const err = new AggregateError([new Error('connect ECONNREFUSED localhost:5435'), new Error('connect ECONNREFUSED localhost:5435'), new Error('')])
    expect(errorMessage(err)).toBe('connect ECONNREFUSED localhost:5435')
  })

  it('plain Error keeps message; empty message and non-Error fall back to String(err)', () => {
    expect(errorMessage(new Error('auth failed'))).toBe('auth failed')
    expect(errorMessage(new Error(''))).toBe('Error')
    expect(errorMessage('boom')).toBe('boom')
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
})
