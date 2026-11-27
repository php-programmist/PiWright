/** mergeDbConnections: белый список полей, лимиты, дедуп, выбрасывание секретов.
 *  settings.json не содержит секретов подключений БД — пароли живут только в db-secrets.json. */
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, mergeDbConnections, mergeProjectDbConnections, SettingsService } from '../src/main/settings/settings'
import type { DbConnectionEntry } from '../src/shared/ipc-contracts'

const valid: Record<string, unknown> = {
  id: 'conn-1',
  name: 'Local',
  kind: 'postgres',
  host: 'db.local',
  port: 5433,
  database: 'app',
  user: 'app_user',
  authType: 'password',
  ssh: { host: 'bastion', port: 2222, user: 'jump', auth: 'key', keyPath: '/keys/id_rsa' },
  selectedSchemas: ['public', 'shop']
}

describe('mergeDbConnections', () => {
  it('non-array yields empty', () => {
    expect(mergeDbConnections(null)).toEqual([])
    expect(mergeDbConnections('x')).toEqual([])
  })

  it('valid entry passes with all fields', () => {
    expect(mergeDbConnections([valid])).toEqual([valid as unknown as DbConnectionEntry])
  })

  it('defaults: port 5432, kind postgres, authType password, name = database', () => {
    const out = mergeDbConnections([{ id: 'c', host: 'h', user: 'u', database: 'db' }])
    expect(out).toEqual([{ id: 'c', name: 'db', kind: 'postgres', host: 'h', port: 5432, database: 'db', user: 'u', authType: 'password' }])
  })

  it('invalid id/host/user/database dropped, duplicates dropped', () => {
    expect(mergeDbConnections([{ id: 'bad id!', host: 'h', user: 'u', database: 'd' }])).toEqual([])
    expect(mergeDbConnections([{ id: 'c', host: '', user: 'u', database: 'd' }])).toEqual([])
    expect(mergeDbConnections([{ id: 'c', host: 'h', user: '', database: 'd' }])).toEqual([])
    expect(mergeDbConnections([{ id: 'c', host: 'h', user: 'u', database: '' }])).toEqual([])
    expect(mergeDbConnections([valid, valid]).length).toBe(1)
  })

  it('port clamped to 1..65535', () => {
    expect(mergeDbConnections([{ id: 'c', host: 'h', user: 'u', database: 'd', port: 0 }])[0].port).toBe(1)
    expect(mergeDbConnections([{ id: 'c', host: 'h', user: 'u', database: 'd', port: 99999 }])[0].port).toBe(65535)
  })

  it('ssh tunnel with bad host dropped, keyPath kept only when non-empty', () => {
    const out = mergeDbConnections([{ id: 'c', host: 'h', user: 'u', database: 'd', ssh: { host: '', user: 'j', port: 22, auth: 'password' } }])
    expect(out[0].ssh).toBeUndefined()
    const out2 = mergeDbConnections([{ id: 'c', host: 'h', user: 'u', database: 'd', ssh: { host: 'b', user: 'j', port: 22, auth: 'password', keyPath: '' } }])
    expect(out2[0].ssh).toEqual({ host: 'b', port: 22, user: 'j', auth: 'password' })
  })

  it('secrets and junk fields are stripped (settings.json never stores passwords)', () => {
    const dirty = { ...valid, password: 'leak', sshPassword: 'leak2', sshKeyPassphrase: 'leak3', extra: true }
    const out = mergeDbConnections([dirty])
    expect(out[0]).not.toHaveProperty('password')
    expect(out[0]).not.toHaveProperty('sshPassword')
    expect(out[0]).not.toHaveProperty('sshKeyPassphrase')
    expect(out[0]).not.toHaveProperty('extra')
  })

  it('selectedSchemas sanitized, empty dropped', () => {
    const out = mergeDbConnections([{ id: 'c', host: 'h', user: 'u', database: 'd', selectedSchemas: ['public', 42, '', 'x'.repeat(100)] }])
    expect(out[0].selectedSchemas).toEqual(['public'])
    const out2 = mergeDbConnections([{ id: 'c', host: 'h', user: 'u', database: 'd', selectedSchemas: [] }])
    expect(out2[0].selectedSchemas).toBeUndefined()
  })

  it('count limited to DB_CONNECTIONS_MAX', () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ id: `c${i}`, host: 'h', user: 'u', database: 'd' }))
    expect(mergeDbConnections(many).length).toBe(20)
  })
})

describe('mergeProjectDbConnections', () => {
  it('non-object yields empty', () => {
    expect(mergeProjectDbConnections(null)).toEqual({})
    expect(mergeProjectDbConnections([['k', []]])).toEqual({})
  })

  it('valid keys sanitized through mergeDbConnections, empty lists dropped', () => {
    const out = mergeProjectDbConnections({
      'native\u0000C:\\proj': [valid],
      'empty': [],
      'junk': 'x',
      '': [valid]
    })
    expect(out).toEqual({ 'native\u0000C:\\proj': [valid as unknown as DbConnectionEntry] })
  })

  it('overlong keys dropped', () => {
    expect(mergeProjectDbConnections({ ['k'.repeat(513)]: [valid] })).toEqual({})
  })
})

describe('SettingsService projectDbConnections', () => {
  it('DEFAULT_SETTINGS has empty projectDbConnections', () => {
    expect(DEFAULT_SETTINGS.projectDbConnections).toEqual({})
  })

  it('projectDbConnections loaded from file, secrets stripped on load, legacy dbConnections dropped', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'piwright-db-settings-'))
    const file = join(dir, 'settings.json')
    await fs.writeFile(
      file,
      JSON.stringify({
        dbConnections: [{ ...valid, password: 'leak' }],
        projectDbConnections: { 'native\u0000C:\\proj': [{ ...valid, password: 'leak' }] }
      }),
      'utf8'
    )
    const service = new SettingsService(file)
    expect(service.get().projectDbConnections).toEqual({ 'native\u0000C:\\proj': [valid as unknown as DbConnectionEntry] })
    // Файл переписывается только при set(): после него секрет-мусор и legacy-поле исчезают.
    service.set({})
    const raw = JSON.parse(await fs.readFile(file, 'utf8'))
    expect(raw.projectDbConnections['native\u0000C:\\proj'][0].password).toBeUndefined()
    expect(raw.dbConnections).toBeUndefined()
  })

  it('saved settings.json contains no password fields', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'piwright-db-settings-'))
    const file = join(dir, 'settings.json')
    const service = new SettingsService(file)
    service.set({ projectDbConnections: mergeProjectDbConnections({ k: [{ ...valid, password: 'leak' }] }) })
    const raw = JSON.parse(await fs.readFile(file, 'utf8'))
    const text = JSON.stringify(raw)
    expect(text.includes('leak')).toBe(false)
    expect(text.includes('projectDbConnections')).toBe(true)
  })
})
