import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DaemonClient, DaemonUnavailableError, setDaemonClientForTests } from '../src/main/daemon/client'
import type { DaemonChildProcess } from '../src/main/daemon/child-process'
import type { DaemonSkewInfo } from '../src/main/daemon/client'
import { DAEMON_PROTO_VERSION } from '../src/main/daemon/protocol'
import { ensureDaemonToken } from '../src/main/daemon/token'
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

  it('kills a detached child after the grace when no new turn starts', async () => {
    // Грейс и kill — на стороне демона (работает и при закрытом приложении): detachChild
    // делает ребёнка фоновым, agent_settled запускает грейс, по истечении — close.
    startServer({ killAfterCloseMs: 20, backgroundGraceMs: 60 })
    await server.start()
    const client = makeClient()
    const { child } = await client.spawn(SPEC, 'C:\\proj\\.pi\\s.json')
    child.on('error', () => {})
    child.on('close', () => {})
    child.detach()
    // detachChild уходит по каналу асинхронно — даём дойти до демона до agent_settled.
    await new Promise((resolve) => setTimeout(resolve, 60))
    children[0].emitData('{"type":"agent_settled"}\n')
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(children[0].killed).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(children[0].killed).toBe(true)
  })

  it('a new turn during the grace cancels the kill', async () => {
    startServer({ killAfterCloseMs: 20, backgroundGraceMs: 60 })
    await server.start()
    const client = makeClient()
    const { child } = await client.spawn(SPEC, 'C:\\proj\\.pi\\s.json')
    child.on('error', () => {})
    child.on('close', () => {})
    child.detach()
    children[0].emitData('{"type":"agent_settled"}\n')
    await new Promise((resolve) => setTimeout(resolve, 30))
    children[0].emitData('{"type":"agent_start"}\n')
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(children[0].killed).toBe(false)
    // Ход снова завершился — грейс перезапускается и убивает.
    children[0].emitData('{"type":"agent_settled"}\n')
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(children[0].killed).toBe(true)
  })

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

  it('rekeys the child so a later spawn attaches by the new session file', async () => {
    startServer()
    await server.start()
    const client = makeClient()
    const { child, sessionKey } = await client.spawn(SPEC, null)
    child.on('error', () => {})
    child.on('close', () => {})
    const sessionFile = 'C:\\proj\\.pi\\handshaked.json'
    await client.rekey(sessionKey, sessionFile)
    const second = await client.spawn(SPEC, sessionFile)
    second.child.on('error', () => {})
    second.child.on('close', () => {})
    expect(second.attached).toBe(true)
    expect(second.sessionKey).toBe(sessionKey)
    expect(children).toHaveLength(1)
  })

  it('detach releases the adapter without killing the child and drops its pushes', async () => {
    startServer()
    await server.start()
    const client = makeClient()
    const { child, sessionKey } = await client.spawn(SPEC, 'C:\\proj\\.pi\\s.json')
    const events: string[] = []
    child.on('error', (err: Error) => events.push(`error:${err.message}`))
    child.on('close', () => events.push('close'))
    child.detach()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(events).toEqual([])
    expect(children[0].killed).toBe(false)
    expect((children[0].stdin.read() as Buffer | null)).toBeNull()

    // Пуши отвязанного ключа не буферизуются: повторный spawn не получает старые строки.
    children[0].emitData('stale\n')
    await new Promise((resolve) => setTimeout(resolve, 50))
    const reattach = await client.spawn(SPEC, 'C:\\proj\\.pi\\s.json')
    reattach.child.on('error', () => {})
    reattach.child.on('close', () => {})
    expect(reattach.attached).toBe(true)
    expect(reattach.sessionKey).toBe(sessionKey)
    const lines: string[] = []
    reattach.child.stdout.setEncoding('utf8')
    reattach.child.stdout.on('data', (chunk: string) => lines.push(chunk))
    children[0].emitData('fresh\n')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(lines.join('')).toBe('fresh\n')
  })

  it('killBackground closes only children without clients', async () => {
    startServer({ killAfterCloseMs: 20 })
    await server.start()
    const client = makeClient()
    const { child } = await client.spawn(SPEC, 'C:\\proj\\.pi\\s.json')
    child.on('error', () => {})
    child.on('close', () => {})
    // Ребёнок аттачен к клиенту — не фоновый.
    expect(await client.killBackground()).toBe(0)
    // detach (крестик во время хода) → detachChild → фоновый.
    child.detach()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await client.killBackground()).toBe(1)
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(children[0].killed).toBe(true)
  })

  it('version skew: callback fires, client disabled until cleared', async () => {
    // Фейковый «старый демон»: отвечает welcome с чужой версией протокола.
    const fake = createServer((socket) => {
      socket.setEncoding('utf8')
      socket.on('data', () => {
        socket.write(`${JSON.stringify({ type: 'welcome', protoVersion: 999, appVersion: '0.4.0', sessions: [] })}\n`)
      })
    })
    await new Promise<void>((resolve) => fake.listen(channel, () => resolve()))
    try {
      const skews: DaemonSkewInfo[] = []
      ensureDaemonToken(userDataDir)
      const client = makeClient({ onVersionSkew: (info) => skews.push(info) })
      await expect(client.connect()).rejects.toBeInstanceOf(DaemonUnavailableError)
      expect(skews).toEqual([{ daemonProto: 999, appProto: DAEMON_PROTO_VERSION, daemonAppVersion: '0.4.0' }])
      expect(client.versionSkew).toBe(true)
      // После решения пользователя блокировка снимается.
      client.clearDisabled()
      expect(client.versionSkew).toBe(false)
    } finally {
      await new Promise<void>((resolve) => fake.close(() => resolve()))
    }
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
