/** DbSecretsService: шифрование через инжектируемый кодек, set (null/undefined-семантика),
 *  персист, битый файл, удаление пустых записей. */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { DbSecretsService } from '../src/main/db/db-secrets'

const dirs: string[] = []

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function makeService(name: string, encrypt?: (v: string) => Buffer, decrypt?: (b: Buffer) => string): DbSecretsService {
  const dir = mkdtempSync(join(tmpdir(), `piwright-db-secrets-${name}-`))
  dirs.push(dir)
  return new DbSecretsService(
    join(dir, 'db-secrets.json'),
    encrypt ?? ((value) => Buffer.from(value, 'utf8')),
    decrypt ?? ((buffer) => buffer.toString('utf8'))
  )
}

describe('DbSecretsService', () => {
  it('missing file yields empty secrets', () => {
    const service = makeService('fresh')
    expect(service.get('c1')).toEqual({})
    expect(service.ids()).toEqual([])
  })

  it('set/get roundtrip with codec', () => {
    const service = makeService(
      'codec',
      (value) => Buffer.from(`enc:${value}`, 'utf8'),
      (buffer) => buffer.toString('utf8').replace(/^enc:/, '')
    )
    service.set('c1', { password: 'db-pass', sshPassword: 'ssh-pass' })
    expect(service.get('c1')).toEqual({ password: 'db-pass', sshPassword: 'ssh-pass' })
    expect(service.ids()).toEqual(['c1'])
    const raw = JSON.parse(readFileSync(join(dirs[dirs.length - 1], 'db-secrets.json'), 'utf8'))
    expect(raw.connections.c1.password).toBe(Buffer.from('enc:db-pass', 'utf8').toString('base64'))
  })

  it('null deletes field, undefined keeps it, empty record removed', () => {
    const service = makeService('patch')
    service.set('c1', { password: 'p', sshPassword: 'sp', sshKeyPassphrase: 'kp' })
    service.set('c1', { password: null })
    expect(service.get('c1')).toEqual({ sshPassword: 'sp', sshKeyPassphrase: 'kp' })
    service.set('c1', { password: undefined })
    expect(service.get('c1')).toEqual({ sshPassword: 'sp', sshKeyPassphrase: 'kp' })
    service.set('c1', { sshPassword: null, sshKeyPassphrase: null })
    expect(service.get('c1')).toEqual({})
    expect(service.ids()).toEqual([])
  })

  it('remove deletes whole record and persists', () => {
    const service = makeService('remove')
    service.set('c1', { password: 'p' })
    service.set('c2', { password: 'q' })
    service.remove('c1')
    expect(service.ids()).toEqual(['c2'])
    const second = new DbSecretsService(
      join(dirs[dirs.length - 1], 'db-secrets.json'),
      (value) => Buffer.from(value, 'utf8'),
      (buffer) => buffer.toString('utf8')
    )
    expect(second.get('c2')).toEqual({ password: 'q' })
    expect(second.get('c1')).toEqual({})
  })

  it('corrupt file falls back to empty', () => {
    const dir = mkdtempSync(join(tmpdir(), 'piwright-db-secrets-corrupt-'))
    dirs.push(dir)
    const file = join(dir, 'db-secrets.json')
    writeFileSync(file, '{ not json', 'utf8')
    const service = new DbSecretsService(
      file,
      (value) => Buffer.from(value, 'utf8'),
      (buffer) => buffer.toString('utf8')
    )
    expect(service.get('c1')).toEqual({})
    expect(existsSync(file)).toBe(true)
  })

  it('undecryptable secret yields empty object', () => {
    const service = makeService('badcodec', (value) => Buffer.from(value, 'utf8'), () => {
      throw new Error('decrypt failed')
    })
    service.set('c1', { password: 'p' })
    expect(service.get('c1')).toEqual({})
  })
})
