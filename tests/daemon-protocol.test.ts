import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connect, type Socket } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DaemonServer } from '../src/main/daemon/server'
import { daemonChannelPath, DAEMON_PROTO_VERSION, parseDaemonMessage } from '../src/main/daemon/protocol'
import { readDaemonToken } from '../src/main/daemon/token'
import type { PiChildProcess, PiSpawnSpec } from '../src/main/pi/backends/types'
import { FakeChild } from './helpers/fake-child'

const SPEC: PiSpawnSpec = { mode: 'native', piPath: 'pi', args: ['--mode', 'rpc'], cwd: 'C:\\proj', env: null }

function testChannel(): string {
  if (process.platform === 'win32') return `\\\\.\\pipe\\piwright-daemon-test-${randomUUID()}`
  return join(mkdtempSync(join(tmpdir(), 'daemon-probe-')), 't.sock')
}

function flushIo(times = 4): Promise<void> {
  let promise = Promise.resolve()
  for (let i = 0; i < times; i++) {
    promise = promise.then(() => new Promise<void>((resolve) => setImmediate(resolve)))
  }
  return promise
}

function connectTo(channel: string): Promise<Socket> {
  return new Promise<Socket>((resolve, reject) => {
    const socket = connect(channel)
    socket.on('connect', () => resolve(socket))
    socket.on('error', reject)
  })
}

/** Клиент канала для тестов: hello + очередь входящих сообщений демона. */
class TestClient {
  readonly messages: Record<string, unknown>[] = []
  private buffer = ''
  private waiters: ((message: Record<string, unknown>) => void)[] = []
  socket: Socket | null = null
  closed = false

  async connect(channel: string, token: string): Promise<void> {
    const socket = await connectTo(channel)
    this.socket = socket
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => this.onData(chunk))
    socket.on('close', () => {
      this.closed = true
    })
    socket.write(`${JSON.stringify({ type: 'hello', token, protoVersion: DAEMON_PROTO_VERSION, appVersion: '0.5.0' })}\n`)
    const welcome = await this.next()
    expect(welcome['type']).toBe('welcome')
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    for (;;) {
      const nl = this.buffer.indexOf('\n')
      if (nl < 0) break
      const line = this.buffer.slice(0, nl)
      this.buffer = this.buffer.slice(nl + 1)
      const parsed = JSON.parse(line) as Record<string, unknown>
      const waiter = this.waiters.shift()
      if (waiter !== undefined) waiter(parsed)
      else this.messages.push(parsed)
    }
  }

  handleData(chunk: string): void {
    this.onData(chunk)
  }

  next(timeoutMs = 2000): Promise<Record<string, unknown>> {
    const queued = this.messages.shift()
    if (queued !== undefined) return Promise.resolve(queued)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no daemon message')), timeoutMs)
      this.waiters.push((message) => {
        clearTimeout(timer)
        resolve(message)
      })
    })
  }

  send(message: unknown): void {
    this.socket?.write(`${JSON.stringify(message)}\n`)
  }

  destroy(): void {
    this.socket?.destroy()
  }
}

describe('daemon protocol', () => {
  let userDataDir: string
  let channel: string
  let server: DaemonServer
  const children: FakeChild[] = []
  let spawnCalls: PiSpawnSpec[]

  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'piwright-daemon-'))
    channel = testChannel()
    children.length = 0
    spawnCalls = []
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
      spawnChild: async (spec) => {
        spawnCalls.push(spec)
        const child = new FakeChild()
        children.push(child)
        return child as unknown as PiChildProcess
      },
      ...opts
    })
  }

  it('writes a token file before listening and answers hello with welcome', async () => {
    startServer()
    expect(await server.start()).toBe('started')
    expect(readDaemonToken(userDataDir)).not.toBeNull()
    const client = new TestClient()
    await client.connect(channel, readDaemonToken(userDataDir) ?? '')
    client.destroy()
  })

  it('reports busy when the channel is already served', async () => {
    startServer()
    await server.start()
    const second = new DaemonServer({
      userDataDir,
      channelPath: channel,
      spawnChild: async () => new FakeChild() as unknown as PiChildProcess
    })
    expect(await second.start()).toBe('busy')
    await second.stop()
  })

  it('drops connections with a wrong token and answers nothing', async () => {
    startServer()
    await server.start()
    const client = new TestClient()
    const socket = await connectTo(channel)
    client.socket = socket
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => client.handleData(chunk))
    socket.on('close', () => {
      client.closed = true
    })
    socket.write(`${JSON.stringify({ type: 'hello', token: 'wrong', protoVersion: DAEMON_PROTO_VERSION, appVersion: 'x' })}\n`)
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(client.closed).toBe(true)
    expect(client.messages).toHaveLength(0)
  })

  it('drops silent connections after the hello timeout', async () => {
    startServer({ helloTimeoutMs: 40 })
    await server.start()
    const socket = await connectTo(channel)
    let closed = false
    socket.on('close', () => {
      closed = true
    })
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(closed).toBe(true)
  })

  it('spawns a child, forwards stdin and pushes stdout/stderr/exit', async () => {
    startServer()
    await server.start()
    const client = new TestClient()
    await client.connect(channel, readDaemonToken(userDataDir) ?? '')

    client.send({ type: 'spawn', id: 'r1', spec: SPEC, sessionFile: 'C:\\proj\\.pi\\s.json' })
    const response = await client.next()
    expect(response).toMatchObject({ type: 'response', id: 'r1', ok: true, data: { attached: false } })
    const sessionKey = (response.data as Record<string, unknown>)['sessionKey'] as string
    expect(spawnCalls).toHaveLength(1)
    expect(spawnCalls[0]).toEqual(SPEC)

    const child = children[0]
    child.emitData('{"type":"agent_start"}\n{"type":"agent_')
    child.emitData('end"}\n')
    child.stderr.write('boom\n')
    const stdout1 = await client.next()
    expect(stdout1).toEqual({ type: 'stdout', sessionKey, line: '{"type":"agent_start"}' })
    const stdout2 = await client.next()
    expect(stdout2).toEqual({ type: 'stdout', sessionKey, line: '{"type":"agent_end"}' })
    const stderr = await client.next()
    expect(stderr).toEqual({ type: 'stderr', sessionKey, line: 'boom' })

    client.send({ type: 'input', sessionKey, chunk: '{"type":"prompt"}\n' })
    await flushIo()
    expect((child.stdin.read() as Buffer).toString('utf8')).toBe('{"type":"prompt"}\n')

    client.send({ type: 'close', sessionKey })
    child.closeWith(0)
    const exit = await client.next()
    expect(exit).toEqual({ type: 'exit', sessionKey, code: 0, cause: null, stderrTail: 'boom' })
  })

  it('kills the child after close when it does not exit by itself', async () => {
    startServer({ killAfterCloseMs: 40 })
    await server.start()
    const client = new TestClient()
    await client.connect(channel, readDaemonToken(userDataDir) ?? '')
    client.send({ type: 'spawn', id: 'r1', spec: SPEC, sessionFile: null })
    const response = await client.next()
    const sessionKey = (response.data as Record<string, unknown>)['sessionKey'] as string
    client.send({ type: 'close', sessionKey })
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(children[0].killed).toBe(true)
  })

  it('attaches to a live child with the same sessionFile', async () => {
    startServer()
    await server.start()
    const client = new TestClient()
    await client.connect(channel, readDaemonToken(userDataDir) ?? '')
    const sessionFile = 'C:\\proj\\.pi\\s.json'
    client.send({ type: 'spawn', id: 'r1', spec: SPEC, sessionFile })
    const first = await client.next()
    const key1 = (first.data as Record<string, unknown>)['sessionKey'] as string

    client.send({ type: 'spawn', id: 'r2', spec: SPEC, sessionFile })
    const second = await client.next()
    expect(second).toMatchObject({ type: 'response', id: 'r2', ok: true, data: { attached: true } })
    expect((second.data as Record<string, unknown>)['sessionKey']).toBe(key1)
    expect(spawnCalls).toHaveLength(1)

    children[0].emitData('line\n')
    const push = await client.next()
    expect(push).toEqual({ type: 'stdout', sessionKey: key1, line: 'line' })
  })

  it('sends a single exit event when error and close both fire', async () => {
    startServer()
    await server.start()
    const client = new TestClient()
    await client.connect(channel, readDaemonToken(userDataDir) ?? '')
    client.send({ type: 'spawn', id: 'r1', spec: SPEC, sessionFile: null })
    await client.next()
    children[0].emit('error', new Error('spawn ENOENT'))
    children[0].closeWith(null)
    const exit = await client.next()
    expect(exit).toEqual({ type: 'exit', sessionKey: expect.any(String), code: null, cause: 'spawn ENOENT', stderrTail: '' })
    expect(client.messages.filter((m) => m['type'] === 'exit')).toHaveLength(0)
  })

  it('answers list with live children only', async () => {
    startServer()
    await server.start()
    const client = new TestClient()
    await client.connect(channel, readDaemonToken(userDataDir) ?? '')
    client.send({ type: 'spawn', id: 'r1', spec: SPEC, sessionFile: 'C:\\proj\\.pi\\s.json' })
    const spawn = await client.next()
    const key = (spawn.data as Record<string, unknown>)['sessionKey'] as string
    client.send({ type: 'list', id: 'r2' })
    const list = await client.next()
    expect(list.data).toEqual({ sessions: [{ sessionKey: key, sessionFile: 'C:\\proj\\.pi\\s.json', mode: 'native' }] })
    children[0].closeWith(0)
    await client.next()
    client.send({ type: 'list', id: 'r3' })
    const empty = await client.next()
    expect(empty.data).toEqual({ sessions: [] })
  })

  it('responds with an error when the child fails to spawn', async () => {
    server = new DaemonServer({
      userDataDir,
      channelPath: channel,
      spawnChild: async () => {
        throw new Error('pi not found')
      }
    })
    await server.start()
    const client = new TestClient()
    await client.connect(channel, readDaemonToken(userDataDir) ?? '')
    client.send({ type: 'spawn', id: 'r1', spec: SPEC, sessionFile: null })
    const response = await client.next()
    expect(response).toMatchObject({ type: 'response', id: 'r1', ok: false, error: 'pi not found' })
  })

  it('keeps the child alive and reading after the client disconnects', async () => {
    startServer()
    await server.start()
    const client = new TestClient()
    await client.connect(channel, readDaemonToken(userDataDir) ?? '')
    client.send({ type: 'spawn', id: 'r1', spec: SPEC, sessionFile: 'C:\\.pi\\s.json' })
    await client.next()
    client.destroy()
    await flushIo()
    children[0].emitData('a\nb\n')
    expect(children[0].killed).toBe(false)
    const second = new TestClient()
    await second.connect(channel, readDaemonToken(userDataDir) ?? '')
    second.send({ type: 'spawn', id: 'r1', spec: SPEC, sessionFile: 'C:\\.pi\\s.json' })
    const attach = await second.next()
    expect((attach.data as Record<string, unknown>)['attached']).toBe(true)
    children[0].emitData('c\n')
    const push = await second.next()
    expect(push).toEqual({ type: 'stdout', sessionKey: (attach.data as Record<string, unknown>)['sessionKey'], line: 'c' })
  })

  it('shuts down on the shutdown command', async () => {
    startServer()
    await server.start()
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const client = new TestClient()
    await client.connect(channel, readDaemonToken(userDataDir) ?? '')
    client.send({ type: 'spawn', id: 'r1', spec: SPEC, sessionFile: null })
    await client.next()
    client.send({ type: 'shutdown', id: 'r2' })
    const response = await client.next()
    expect(response).toMatchObject({ type: 'response', id: 'r2', ok: true })
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(exitSpy).toHaveBeenCalledWith(0)
    expect(children[0].killed).toBe(true)
  })

  it('exits by itself after the idle timeout with no children and no clients', async () => {
    startServer({ idleExitMs: 60 })
    await server.start()
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const client = new TestClient()
    await client.connect(channel, readDaemonToken(userDataDir) ?? '')
    client.send({ type: 'spawn', id: 'r1', spec: SPEC, sessionFile: null })
    await client.next()
    children[0].closeWith(0)
    await client.next()
    client.destroy()
    await flushIo()
    await new Promise((resolve) => setTimeout(resolve, 160))
    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  it('does not exit while a client is connected even without children', async () => {
    startServer({ idleExitMs: 60 })
    await server.start()
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const client = new TestClient()
    await client.connect(channel, readDaemonToken(userDataDir) ?? '')
    await new Promise((resolve) => setTimeout(resolve, 160))
    expect(client.closed).toBe(false)
    client.destroy()
  })
})

describe('daemon protocol parsing', () => {
  it('parses objects and rejects the rest', () => {
    expect(parseDaemonMessage('{"type":"stdout","sessionKey":"s1","line":"x"}')).toMatchObject({ type: 'stdout' })
    expect(parseDaemonMessage('not json')).toBeNull()
    expect(parseDaemonMessage('[1,2]')).toBeNull()
    expect(parseDaemonMessage('{"noType":1}')).toBeNull()
  })

  it('builds a per-user channel path', () => {
    const path = daemonChannelPath('C:\\Users\\x\\AppData\\PiWright')
    if (process.platform === 'win32') expect(path).toMatch(/^\\\\\.\\pipe\\piwright-daemon-[0-9a-f]{32}$/)
    else expect(path).toContain('daemon.sock')
  })
})
