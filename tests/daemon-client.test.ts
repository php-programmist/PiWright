import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DaemonClient, setDaemonClientForTests } from '../src/main/daemon/client'
import type { DaemonChildProcess } from '../src/main/daemon/child-process'
import { createDaemonSpawner } from '../src/main/daemon/spawner'
import { DaemonServer } from '../src/main/daemon/server'
import type { PiChildProcess, PiSpawnSpec } from '../src/main/pi/backends/types'
import { FakeChild } from './helpers/fake-child'

const SPEC: PiSpawnSpec = { mode: 'native', piPath: 'pi', args: ['--mode', 'rpc'], cwd: 'C:\\proj', env: null }

function testChannel(): string {
  if (process.platform === 'win32') return `\\\\.\\pipe\\piwright-daemon-test-${randomUUID()}`
  return join(mkdtempSync(join(tmpdir(), 'daemon-client-')), 't.sock')
}

describe('DaemonClient', () => {
  let userDataDir: string
  let channel: string
  let server: DaemonServer
  let children: FakeChild[]

  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'piwright-daemon-'))
    channel = testChannel()
    children = []
  })

  afterEach(async () => {
    await server?.stop()
    try {
      rmSync(userDataDir, { recursive: true, force: true })
    } catch {
      // tmp
    }
    vi.restoreAllMocks()
  })

  function startServer(opts: Partial<ConstructorParameters<typeof DaemonServer>[0]> = {}): void {
    server = new DaemonServer({
      userDataDir,
      channelPath: channel,
      appVersion: '0.5.0',
      spawnChild: async () => {
        const child = new FakeChild()
        children.push(child)
        return child as unknown as PiChildProcess
      },
      ...opts
    })
  }

  function makeClient(opts: Partial<ConstructorParameters<typeof DaemonClient>[0]> = {}): DaemonClient {
    return new DaemonClient({ userDataDir, appVersion: '0.5.0', channelPath: channel, ...opts })
  }

  it('spawns through the daemon and wires the adapter', async () => {
    startServer()
    await server.start()
    const client = makeClient()
    const { child, sessionKey, attached } = await client.spawn(SPEC, 'C:\\proj\\.pi\\s.json')
    expect(attached).toBe(false)
    expect(sessionKey).toBeTruthy()
    child.on('error', () => {})
    child.on('close', () => {})

    const lines: string[] = []
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => lines.push(chunk))
    children[0].emitData('{"a":1}\n')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(lines.join('')).toBe('{"a":1}\n')

    child.stdin.write('ping\n')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect((children[0].stdin.read() as Buffer).toString('utf8')).toBe('ping\n')
  })

  it('delivers exit as error+close on the adapter', async () => {
    startServer()
    await server.start()
    const client = makeClient()
    const { child } = await client.spawn(SPEC, null)
    const events: string[] = []
    child.on('error', (err: Error) => events.push(`error:${err.message}`))
    child.on('close', (code: number | null) => events.push(`close:${code ?? 'null'}`))
    children[0].emit('error', new Error('spawn ENOENT'))
    children[0].closeWith(null)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(events).toEqual(['error:spawn ENOENT', 'close:null'])
  })

  it('kills through the daemon on adapter kill', async () => {
    startServer({ killAfterCloseMs: 30 })
    await server.start()
    const client = makeClient()
    const { child } = await client.spawn(SPEC, null)
    child.on('error', () => {})
    child.on('close', () => {})
    child.kill()
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(children[0].killed).toBe(true)
  })

  it('rejects spawn when the daemon is unreachable and no entry exists', async () => {
    const client = makeClient({
      channelPath: testChannel(),
      connectRetryTotalMs: 200,
      connectRetryMs: 30
    })
    await expect(client.spawn(SPEC, null)).rejects.toThrow('daemon unavailable')
  })

  it('disconnects adapters when the daemon dies', async () => {
    startServer()
    await server.start()
    const client = makeClient()
    const { child } = await client.spawn(SPEC, null)
    const events: string[] = []
    child.on('error', (err: Error) => events.push(err.message))
    child.on('close', () => events.push('close'))
    await server.stop()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(events).toEqual(['daemon connection lost', 'close'])
  })

  it('lists live sessions', async () => {
    startServer()
    await server.start()
    const client = makeClient()
    const { child } = await client.spawn(SPEC, 'C:\\proj\\.pi\\s.json')
    child.on('error', () => {})
    child.on('close', () => {})
    const sessions = await client.list()
    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({ sessionFile: 'C:\\proj\\.pi\\s.json', mode: 'native' })
  })
})

describe('daemon spawner', () => {
  afterEach(() => {
    setDaemonClientForTests(null)
    vi.restoreAllMocks()
  })

  it('falls back to local spawn when no client is configured', async () => {
    setDaemonClientForTests(null)
    const local = vi.fn(async () => new FakeChild() as unknown as PiChildProcess)
    const spawner = createDaemonSpawner({ buildSpec: () => SPEC, spawnLocal: local })
    const child = await spawner({ cwd: 'C:\\proj', args: ['--mode', 'rpc'] })
    expect(child).toBeTruthy()
    expect(local).toHaveBeenCalledOnce()
  })

  it('falls back to local spawn when the daemon is unavailable', async () => {
    const local = vi.fn(async () => new FakeChild() as unknown as PiChildProcess)
    const failing = new DaemonClient({
      userDataDir: mkdtempSync(join(tmpdir(), 'piwright-daemon-')),
      appVersion: 'test',
      channelPath: testChannel(),
      connectRetryTotalMs: 150,
      connectRetryMs: 30
    })
    setDaemonClientForTests(failing)
    const spawner = createDaemonSpawner({ buildSpec: () => SPEC, spawnLocal: local })
    await spawner({ cwd: 'C:\\proj', args: ['--mode', 'rpc'] })
    expect(local).toHaveBeenCalledOnce()
  })

  it('propagates spawn errors from the daemon without a local fallback', async () => {
    const channel = testChannel()
    const dir = mkdtempSync(join(tmpdir(), 'piwright-daemon-'))
    const server = new DaemonServer({
      userDataDir: dir,
      channelPath: channel,
      spawnChild: async () => {
        throw new Error('pi not found')
      }
    })
    await server.start()
    const client = new DaemonClient({ userDataDir: dir, appVersion: 'test', channelPath: channel })
    setDaemonClientForTests(client)
    const local = vi.fn(async () => new FakeChild() as unknown as PiChildProcess)
    const spawner = createDaemonSpawner({ buildSpec: () => SPEC, spawnLocal: local })
    try {
      await expect(spawner({ cwd: 'C:\\proj', args: ['--mode', 'rpc'] })).rejects.toThrow('pi not found')
      expect(local).not.toHaveBeenCalled()
    } finally {
      await server.stop()
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // tmp
      }
    }
  })

  it('extracts the session file from spawn args and attaches on the second spawn', async () => {
    const channel = testChannel()
    const dir = mkdtempSync(join(tmpdir(), 'piwright-daemon-'))
    const server = new DaemonServer({
      userDataDir: dir,
      channelPath: channel,
      spawnChild: async () => new FakeChild() as unknown as PiChildProcess
    })
    await server.start()
    const client = new DaemonClient({ userDataDir: dir, appVersion: 'test', channelPath: channel })
    setDaemonClientForTests(client)
    const spawner = createDaemonSpawner({ buildSpec: () => SPEC })
    try {
      const first = await spawner({ cwd: 'C:\\proj', args: ['--mode', 'rpc', '--session', 'C:\\proj\\.pi\\s.json'] })
      const second = await spawner({ cwd: 'C:\\proj', args: ['--mode', 'rpc', '--session', 'C:\\proj\\.pi\\s.json'] })
      for (const child of [first, second]) {
        child.on('error', () => {})
        child.on('close', () => {})
      }
      expect((second as DaemonChildProcess).sessionKey).toBe((first as DaemonChildProcess).sessionKey)
      const sessions = await client.list()
      expect(sessions).toHaveLength(1)
    } finally {
      await server.stop()
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        // tmp
      }
    }
  })
})
