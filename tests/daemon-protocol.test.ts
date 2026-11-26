import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connect, type Socket } from 'node:net'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DaemonServer } from '../src/main/daemon/server'
import { daemonLaunchCommand } from '../src/main/daemon/client'
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

  async connect(channel: string, token: string, telegramToken?: string): Promise<void> {
    const socket = await connectTo(channel)
    this.socket = socket
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => this.onData(chunk))
    socket.on('close', () => {
      this.closed = true
    })
    socket.write(
      `${JSON.stringify({ type: 'hello', token, protoVersion: DAEMON_PROTO_VERSION, appVersion: '0.5.0', telegramToken })}\n`
    )
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
    expect(second).toMatchObject({ type: 'response', id: 'r2', ok: true, data: { attached: true, streaming: false } })
    expect((second.data as Record<string, unknown>)['sessionKey']).toBe(key1)
    expect(spawnCalls).toHaveLength(1)

    children[0].emitData('line\n')
    const push = await client.next()
    expect(push).toEqual({ type: 'stdout', sessionKey: key1, line: 'line' })
  })

  it('reports streaming:true when attaching to a child mid-turn', async () => {
    startServer()
    await server.start()
    const client = new TestClient()
    await client.connect(channel, readDaemonToken(userDataDir) ?? '')
    const sessionFile = 'C:\\proj\\.pi\\s.json'
    client.send({ type: 'spawn', id: 'r1', spec: SPEC, sessionFile })
    const first = await client.next()
    const key1 = (first.data as Record<string, unknown>)['sessionKey'] as string

    children[0].emitData(`${JSON.stringify({ type: 'agent_start' })}\n`)
    const push = await client.next()
    expect(push).toEqual({ type: 'stdout', sessionKey: key1, line: '{"type":"agent_start"}' })

    client.send({ type: 'spawn', id: 'r2', spec: SPEC, sessionFile })
    const second = await client.next()
    expect(second).toMatchObject({ type: 'response', id: 'r2', ok: true, data: { attached: true, streaming: true } })
    expect((second.data as Record<string, unknown>)['sessionKey']).toBe(key1)
  })

  it('rekeys a child spawned without a session file and attaches by the new file', async () => {
    startServer()
    await server.start()
    const client = new TestClient()
    await client.connect(channel, readDaemonToken(userDataDir) ?? '')
    client.send({ type: 'spawn', id: 'r1', spec: SPEC, sessionFile: null })
    const spawn = await client.next()
    const key = (spawn.data as Record<string, unknown>)['sessionKey'] as string

    client.send({ type: 'list', id: 'r2' })
    const before = await client.next()
    expect((before.data as Record<string, unknown>)['sessions']).toEqual([
      { sessionKey: key, sessionFile: null, mode: 'native', clients: 1, projectDir: 'C:\\proj', title: null, streaming: false }
    ])

    const sessionFile = 'C:\\proj\\.pi\\new.json'
    client.send({ type: 'rekey', id: 'r3', sessionKey: key, sessionFile })
    const rekeyed = await client.next()
    expect(rekeyed).toMatchObject({ type: 'response', id: 'r3', ok: true, data: { sessionKey: key, sessionFile } })

    client.send({ type: 'list', id: 'r4' })
    const after = await client.next()
    expect((after.data as Record<string, unknown>)['sessions']).toEqual([
      { sessionKey: key, sessionFile, mode: 'native', clients: 1, projectDir: 'C:\\proj', title: null, streaming: false }
    ])

    client.send({ type: 'spawn', id: 'r5', spec: SPEC, sessionFile })
    const attach = await client.next()
    expect(attach).toMatchObject({ type: 'response', id: 'r5', ok: true, data: { sessionKey: key, attached: true } })
    expect(spawnCalls).toHaveLength(1)
  })

  it('rejects rekey for unknown keys and for a session file tracked by another child', async () => {
    startServer()
    await server.start()
    const client = new TestClient()
    await client.connect(channel, readDaemonToken(userDataDir) ?? '')
    client.send({ type: 'rekey', id: 'r1', sessionKey: 'nope', sessionFile: 'C:\\x.json' })
    const unknown = await client.next()
    expect(unknown).toMatchObject({ type: 'response', id: 'r1', ok: false, error: 'unknown session' })

    client.send({ type: 'spawn', id: 'r2', spec: SPEC, sessionFile: 'C:\\proj\\.pi\\a.json' })
    await client.next()
    client.send({ type: 'spawn', id: 'r3', spec: SPEC, sessionFile: 'C:\\proj\\.pi\\b.json' })
    const second = await client.next()
    const key2 = (second.data as Record<string, unknown>)['sessionKey'] as string
    client.send({ type: 'rekey', id: 'r4', sessionKey: key2, sessionFile: 'C:\\proj\\.pi\\a.json' })
    const busy = await client.next()
    expect(busy).toMatchObject({ type: 'response', id: 'r4', ok: false, error: 'session file already tracked' })
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
    expect(list.data).toEqual({
      sessions: [
        { sessionKey: key, sessionFile: 'C:\\proj\\.pi\\s.json', mode: 'native', clients: 1, projectDir: 'C:\\proj', title: null, streaming: false }
      ]
    })
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

  it('quotes -ArgumentList elements so paths with spaces survive PS 5.1', () => {
    const command = daemonLaunchCommand(
      'D:\\Program Files\\PiWright\\PiWright.exe',
      'D:\\Program Files\\PiWright\\resources\\app.asar\\out\\daemon\\index.js',
      'C:\\Users\\John Smith\\AppData\\Roaming\\piwright',
      '0.5.1'
    )
    expect(command).toContain("-FilePath 'D:\\Program Files\\PiWright\\PiWright.exe'")
    expect(command).toContain('"D:\\Program Files\\PiWright\\resources\\app.asar\\out\\daemon\\index.js"')
    expect(command).toContain('"C:\\Users\\John Smith\\AppData\\Roaming\\piwright"')
    expect(command).toContain('"--user-data"')
    expect(command).toContain('"0.5.1"')
    // одинарная кавычка в значении удваивается (экранирование PS), двойные остаются на месте
    const quoted = daemonLaunchCommand('x', "o'brien.js", 'dir', '1.0')
    expect(quoted).toContain("\"o''brien.js\"")
  })
})

describe('daemon background notifications', () => {
  let userDataDir: string
  let channel: string
  let settingsPath: string
  let server: DaemonServer
  const children: FakeChild[] = []
  let sounds: string[]
  const telegramPosts: { chatId: string; text: string }[] = []

  const SESSION_FILE = 'C:\\proj\\.pi\\s.json'

  function writeSettings(patch: Record<string, unknown>): void {
    const base = {
      notifications: {
        sounds: { completion: '', await: '', error: '' },
        telegram: { chatId: '42', events: { turnEnd: true, permission: true, question: true, error: true, loopEnd: false } },
        remote: { enabled: false, port: 7690, staticPin: '' },
        backgroundGraceMinutes: 10
      },
      sessionToggles: { [SESSION_FILE]: { telegram: true, shared: false } },
      ...patch
    }
    writeFileSync(settingsPath, JSON.stringify(base), 'utf8')
  }

  beforeEach(() => {
    userDataDir = mkdtempSync(join(tmpdir(), 'piwright-daemon-notify-'))
    channel = testChannel()
    settingsPath = join(userDataDir, 'settings.json')
    children.length = 0
    sounds = []
    telegramPosts.length = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: { body?: string }) => {
        const body = JSON.parse(init?.body ?? '{}') as { chat_id: string; text: string }
        telegramPosts.push({ chatId: body.chat_id, text: body.text })
        return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response
      })
    )
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
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
      settingsPath,
      playSound: (path) => sounds.push(path),
      spawnChild: async () => {
        const child = new FakeChild()
        children.push(child)
        return child as unknown as PiChildProcess
      },
      ...opts
    })
  }

  /** Спавн ребёнка; клиент можно оставить подключённым или закрыть (приложение закрылось).
   *  startTurn — ход начинается до отключения: иначе disconnect убьёт idle-ребёнка. */
  async function spawnChild(
    sessionFile: string | null,
    opts: { keepConnected?: boolean; startTurn?: boolean } = {}
  ): Promise<{ client: TestClient; sessionKey: string }> {
    const client = new TestClient()
    await client.connect(channel, readDaemonToken(userDataDir) ?? '', '123:ABC')
    client.send({ type: 'spawn', id: 'r1', spec: SPEC, sessionFile })
    const response = await client.next()
    expect(response).toMatchObject({ type: 'response', ok: true })
    const sessionKey = (response.data as Record<string, unknown>)['sessionKey'] as string
    if (opts.startTurn === true) {
      children[children.length - 1].emitData('{"type":"agent_start"}\n')
      await flushIo()
    }
    if (opts.keepConnected !== true) client.destroy()
    await flushIo()
    return { client, sessionKey }
  }

  it('turn end without a client: sound + telegram + grace kill', async () => {
    writeSettings({})
    startServer({ killAfterCloseMs: 20, backgroundGraceMs: 80 })
    await server.start()
    await spawnChild(SESSION_FILE, { startTurn: true })
    // Ход дописался уже без клиента (приложение закрыто).
    children[0].emitData('{"type":"agent_settled"}\n')
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(sounds).toEqual([''])
    expect(telegramPosts).toEqual([{ chatId: '42', text: 'proj · session: ход завершён' }])
    expect(children[0].killed).toBe(false)
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(children[0].killed).toBe(true)
  })

  it('session telegram toggle off: sound plays, telegram silent', async () => {
    writeSettings({ sessionToggles: {} })
    startServer({ backgroundGraceMs: 10_000 })
    await server.start()
    await spawnChild(SESSION_FILE, { startTurn: true })
    children[0].emitData('{"type":"agent_settled"}\n')
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(sounds).toEqual([''])
    expect(telegramPosts).toEqual([])
  })

  it('client still connected: daemon stays silent (main sends notifications)', async () => {
    writeSettings({})
    startServer({ backgroundGraceMs: 10_000 })
    await server.start()
    await spawnChild(SESSION_FILE, { keepConnected: true })
    children[0].emitData('{"type":"agent_settled"}\n')
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(sounds).toEqual([])
    expect(telegramPosts).toEqual([])
    expect(children[0].killed).toBe(false)
  })

  it('turn error (message_end stopReason=error) notifies as error', async () => {
    writeSettings({})
    startServer({ backgroundGraceMs: 10_000 })
    await server.start()
    await spawnChild(SESSION_FILE, { startTurn: true })
    children[0].emitData('{"type":"message_end","message":{"stopReason":"error","errorMessage":"boom"}}\n')
    children[0].emitData('{"type":"agent_end"}\n')
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(telegramPosts).toEqual([{ chatId: '42', text: 'proj · session: ошибка (boom)' }])
  })

  it('extension_ui_request without a client notifies permission/question', async () => {
    writeSettings({})
    startServer({ backgroundGraceMs: 10_000 })
    await server.start()
    await spawnChild(SESSION_FILE, { startTurn: true })
    // setStatus/setWidget — не диалоги, уведомления нет.
    children[0].emitData('{"type":"extension_ui_request","id":"s1","method":"setStatus","statusKey":"lsp","statusText":"ok"}\n')
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(telegramPosts).toEqual([])
    children[0].emitData('{"type":"extension_ui_request","id":"d1","method":"confirm","title":"run?"}\n')
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(telegramPosts).toEqual([{ chatId: '42', text: 'proj · session: просит разрешение на команду' }])
    telegramPosts.length = 0
    // Повторный кадр того же диалога — молча.
    children[0].emitData('{"type":"extension_ui_request","id":"d1","method":"confirm","title":"run?"}\n')
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(telegramPosts).toEqual([])
    children[0].emitData('{"type":"extension_ui_request","id":"d2","method":"input","title":"q?"}\n')
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(telegramPosts).toEqual([{ chatId: '42', text: 'proj · session: нужен ответ' }])
  })

  it('agent_end and agent_settled of one turn notify once', async () => {
    writeSettings({})
    startServer({ backgroundGraceMs: 10_000 })
    await server.start()
    await spawnChild(SESSION_FILE, { startTurn: true })
    children[0].emitData('{"type":"agent_end"}\n')
    children[0].emitData('{"type":"agent_settled"}\n')
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(telegramPosts).toEqual([{ chatId: '42', text: 'proj · session: ход завершён' }])
  })

  it('attach during the grace cancels the kill', async () => {
    writeSettings({})
    startServer({ killAfterCloseMs: 20, backgroundGraceMs: 150 })
    await server.start()
    const { sessionKey } = await spawnChild(SESSION_FILE, { startTurn: true })
    children[0].emitData('{"type":"agent_settled"}\n')
    await new Promise((resolve) => setTimeout(resolve, 40))
    // Приложение открыли заново: attach по тому же sessionFile отменяет грейс.
    // Второй клиент остаётся подключённым: иначе disconnect убьёт idle-ребёнка.
    const second = new TestClient()
    await second.connect(channel, readDaemonToken(userDataDir) ?? '')
    second.send({ type: 'spawn', id: 'r2', spec: SPEC, sessionFile: SESSION_FILE })
    const response = await second.next()
    expect(response).toMatchObject({ type: 'response', ok: true, data: { attached: true, sessionKey } })
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(children[0].killed).toBe(false)
  })

  it('idle child is killed when the client disconnects, a streaming one survives', async () => {
    writeSettings({})
    startServer({ killAfterCloseMs: 20, backgroundGraceMs: 10_000 })
    await server.start()
    // Первый — idle (хода нет): умрёт при отключении клиента.
    await spawnChild(SESSION_FILE)
    // Второй — в ходе: переживёт отключение и дозает ход.
    const second = new TestClient()
    await second.connect(channel, readDaemonToken(userDataDir) ?? '')
    second.send({ type: 'spawn', id: 'r2', spec: SPEC, sessionFile: null })
    await second.next()
    children[1].emitData('{"type":"agent_start"}\n')
    await flushIo()
    // Оба клиента отключились (приложение закрылось): idle умирает, занятый дозает ход.
    second.destroy()
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(children[0].killed).toBe(true)
    expect(children[1].killed).toBe(false)
  })

  it('detachChild makes the child background while the client stays connected', async () => {
    writeSettings({})
    startServer({ killAfterCloseMs: 20, backgroundGraceMs: 10_000 })
    await server.start()
    const { client, sessionKey } = await spawnChild(SESSION_FILE, { keepConnected: true })
    client.send({ type: 'detachChild', sessionKey })
    await flushIo()
    children[0].emitData('{"type":"agent_settled"}\n')
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(telegramPosts).toEqual([{ chatId: '42', text: 'proj · session: ход завершён' }])
  })

  it('killBackground stops only children without clients and reports the count', async () => {
    writeSettings({})
    startServer({ killAfterCloseMs: 20 })
    await server.start()
    const { client } = await spawnChild(SESSION_FILE, { keepConnected: true })
    // Фоновый: спавн вторым клиентом, ход начался, клиент отключился (стриминг — переживает).
    const second = new TestClient()
    await second.connect(channel, readDaemonToken(userDataDir) ?? '')
    second.send({ type: 'spawn', id: 'r2', spec: SPEC, sessionFile: 'C:\\proj\\.pi\\bg.json' })
    await second.next()
    children[1].emitData('{"type":"agent_start"}\n')
    await flushIo()
    second.destroy()
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(children[1].killed).toBe(false)
    client.send({ type: 'killBackground', id: 'kb1' })
    const kb = await client.next()
    expect(kb).toMatchObject({ type: 'response', id: 'kb1', ok: true, data: { stopped: 1 } })
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(children[0].killed).toBe(false)
    expect(children[1].killed).toBe(true)
  })

  it('list reports the clients count per child', async () => {
    writeSettings({})
    startServer()
    await server.start()
    const { client, sessionKey } = await spawnChild(SESSION_FILE, { keepConnected: true })
    client.send({ type: 'list', id: 'l1' })
    const response = await client.next()
    const sessions = (response.data as Record<string, unknown>)['sessions'] as Record<string, unknown>[]
    expect(sessions).toEqual([
      { sessionKey, sessionFile: SESSION_FILE, mode: 'native', clients: 1, projectDir: 'C:\\proj', title: null, streaming: false }
    ])
  })

  it('hello telegramToken reaches the telegram request URL', async () => {
    writeSettings({})
    startServer({ backgroundGraceMs: 10_000 })
    await server.start()
    const client = new TestClient()
    const socket = await connectTo(channel)
    client.socket = socket
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => client.handleData(chunk))
    socket.write(
      `${JSON.stringify({ type: 'hello', token: readDaemonToken(userDataDir) ?? '', protoVersion: DAEMON_PROTO_VERSION, appVersion: '0.5.0', telegramToken: '123:ABC' })}\n`
    )
    await client.next()
    client.send({ type: 'spawn', id: 'r1', spec: SPEC, sessionFile: SESSION_FILE })
    await client.next()
    children[0].emitData('{"type":"agent_start"}\n')
    await flushIo()
    client.destroy()
    await flushIo()
    children[0].emitData('{"type":"agent_settled"}\n')
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(telegramPosts).toHaveLength(1)
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain('/bot123:ABC/sendMessage')
  })
})
