import { describe, expect, it } from 'vitest'
import { RemoteBridge, RemoteSession } from '../src/main/remote/bridge'
import { RemoteAuth } from '../src/main/remote/auth'
import type { SessionHost } from '../src/main/pi/session-host'
import type { PiHost } from '../src/main/pi/pi-host'
import type { PiResponse } from '../src/shared/protocol-types'
import type { ProjectEntry, Settings } from '../src/shared/ipc-contracts'
import { DEFAULT_SETTINGS } from '../src/main/settings/settings'
import type { RemoteSocket } from '../src/main/remote/ws'

const project: ProjectEntry = { kind: 'native', dir: 'D:\\Work\\api' }

interface FakeSocket extends RemoteSocket {
  lines: string[]
}

function fakeSocket(seq: number): FakeSocket {
  const socket: FakeSocket = { seq, peer: '127.0.0.1', lines: [], send(line: string) { socket.lines.push(line) }, close() {} }
  return socket
}

/** Фейковый SessionHost: только то, что читает мост. */
function fakeHost(overrides: Partial<Record<'streaming' | 'displayTitle', unknown>> = {}): SessionHost {
  const host = {
    id: 'host-1',
    project,
    streaming: overrides['streaming'] ?? false,
    displayTitle: overrides['displayTitle'] ?? 'fix auth',
    telegramEnabled: false,
    remoteTaps: [] as ((line: string) => void)[],
    sentLines: [] as string[],
    respondUiCalls: [] as unknown[],
    addRemoteTap(tap: (line: string) => void) {
      host.remoteTaps.push(tap)
    },
    removeRemoteTap(tap: (line: string) => void) {
      host.remoteTaps = host.remoteTaps.filter((t) => t !== tap)
    },
    sendRemoteLine(line: string) {
      host.sentLines.push(line)
    },
    requestRemote(_type: string): Promise<PiResponse> {
      return Promise.resolve({ id: '1', command: _type, success: true, data: { messages: [] }, error: null })
    },
    respondRemoteUi(id: string, fields: unknown) {
      host.respondUiCalls.push([id, fields])
    },
    rename() {
      return Promise.resolve({ ok: true, error: null })
    },
    setModel() {
      return Promise.resolve({ ok: true, error: null })
    },
    setThinkingLevel() {
      return Promise.resolve({ ok: true, error: null })
    }
  }
  return host as unknown as SessionHost
}

function fakePiHost(hosts: SessionHost[]): PiHost {
  return {
    statuses: () => hosts.map((h) => ({ hostId: (h as unknown as { id: string }).id })),
    get: (hostId: string) => hosts.find((h) => (h as unknown as { id: string }).id === hostId) ?? null
  } as unknown as PiHost
}

function bridgeWith(hosts: SessionHost[]): { bridge: RemoteBridge; auth: RemoteAuth } {
  const auth = new RemoteAuth('123456')
  const settings = (): Settings => ({ ...DEFAULT_SETTINGS })
  return { bridge: new RemoteBridge(settings, fakePiHost(hosts), auth), auth }
}

/** Мост с расшаренной первой сессией (шаринг теперь явный — глобус в шапке чата). */
function sharedBridge(hosts: SessionHost[]): { bridge: RemoteBridge; auth: RemoteAuth } {
  const created = bridgeWith(hosts)
  if (hosts.length > 0) {
    const hostId = (hosts[0] as unknown as { id: string }).id
    expect(created.bridge.setSharedByHost(hostId, true)).toBe(true)
  }
  return created
}

describe('RemoteBridge', () => {
  it('сессия не видна телефону, пока её не расшарили глобусом; unshare снимает', () => {
    const host = fakeHost()
    const { bridge } = bridgeWith([host])
    bridge.syncSessions()
    expect((host as unknown as { remoteTaps: unknown[] }).remoteTaps).toHaveLength(0)
    expect(bridge.sharedFor('host-1')).toBe(false)
    expect(bridge.setSharedByHost('host-1', true)).toBe(true)
    expect(bridge.sharedFor('host-1')).toBe(true)
    expect((host as unknown as { remoteTaps: unknown[] }).remoteTaps).toHaveLength(1)
    bridge.syncSessions()
    expect((host as unknown as { remoteTaps: unknown[] }).remoteTaps).toHaveLength(1)
    expect(bridge.setSharedByHost('host-1', false)).toBe(true)
    expect((host as unknown as { remoteTaps: unknown[] }).remoteTaps).toHaveLength(0)
    expect(bridge.setSharedByHost('no-such-host', true)).toBe(false)
  })

  it('session list frame carries title/project/status/telegram', () => {
    const host = fakeHost({ streaming: true })
    const { bridge } = sharedBridge([host])
    const socket = fakeSocket(1)
    bridge['onOpen'](socket)
    const frame = JSON.parse(socket.lines[0]) as { type: string; sessions: { status: string; project: string; title: string }[] }
    expect(frame.type).toBe('sessions')
    expect(frame.sessions[0]).toMatchObject({ title: 'fix auth', project: 'api', status: 'busy', telegram: false })
  })

  it('attach sends attached + snapshot + todos, dialog lines are replayed', async () => {
    const host = fakeHost()
    const { bridge } = sharedBridge([host])
    const remote = [...bridge['sessions'].values()][0]
    const rawDialog = JSON.stringify({
      type: 'extension_ui_request',
      id: 'ui-1',
      method: 'confirm',
      title: 'run?',
      timeout: 5000
    })
    remote.tap(rawDialog)
    const socket = fakeSocket(2)
    bridge['onText'](socket, JSON.stringify({ type: 'attach', id: remote.id }))
    await new Promise((resolve) => setTimeout(resolve, 20))
    const frames = socket.lines.map((l) => JSON.parse(l) as { type: string; id?: string })
    expect(frames.some((f) => f.type === 'attached')).toBe(true)
    expect(frames.filter((f) => f.type === 'snapshot').length).toBeGreaterThanOrEqual(1)
    expect(frames.some((f) => f.type === 'todos')).toBe(true)
    expect(frames.filter((f) => f.type === 'extension_ui_request')).toEqual([
      { type: 'extension_ui_request', id: 'ui-1', method: 'confirm', title: 'run?', timeout: 5000 }
    ])
  })

  it('phone prompt is forwarded with rewritten id; response is routed back with original id', () => {
    const host = fakeHost()
    const { bridge } = sharedBridge([host])
    const remote = [...bridge['sessions'].values()][0]
    const socket = fakeSocket(7)
    bridge['onOpen'](socket)
    bridge['onText'](socket, JSON.stringify({ type: 'attach', id: remote.id }))
    socket.lines.length = 0
    bridge['onText'](socket, JSON.stringify({ type: 'prompt', id: 'p1', text: 'hello' }))
    const sent = (host as unknown as { sentLines: string[] }).sentLines
    expect(sent).toHaveLength(1)
    const forwarded = JSON.parse(sent[0]) as { type: string; id: string; message: string }
    expect(forwarded.type).toBe('prompt')
    expect(forwarded.id).toBe('web-7-p1')
    expect(forwarded.message).toBe('hello')

    remote.tap(JSON.stringify({ type: 'response', id: 'web-7-p1', success: true, command: 'prompt' }))
    const response = JSON.parse(socket.lines[0]) as { type: string; id: string }
    expect(response.id).toBe('p1')
  })

  it('events broadcast to attached sockets, agent_start updates status to busy', () => {
    const host = fakeHost({ streaming: false })
    const { bridge } = sharedBridge([host])
    const remote = [...bridge['sessions'].values()][0]
    const socket = fakeSocket(1)
    bridge['onOpen'](socket)
    bridge['onText'](socket, JSON.stringify({ type: 'attach', id: remote.id }))
    socket.lines.length = 0
    remote.tap(JSON.stringify({ type: 'message_update', text: 'x' }))
    expect(socket.lines).toHaveLength(1)
    remote.tap(JSON.stringify({ type: 'agent_start' }))
    const sessions = socket.lines.map((l) => JSON.parse(l) as { type: string; sessions?: { status: string }[] }).find((f) => f.type === 'sessions')
    expect(sessions?.sessions?.[0].status).toBe('busy')
  })

  it('setWidget/setStatus fire-and-forget не регистрируются как pending — точка остаётся busy при стриминге', () => {
    const host = fakeHost({ streaming: true })
    const { bridge } = sharedBridge([host])
    const remote = [...bridge['sessions'].values()][0]
    remote.tap(JSON.stringify({ type: 'extension_ui_request', id: 'w-1', method: 'setWidget', widgetKey: 'todo', widgetLines: ['a'] }))
    remote.tap(JSON.stringify({ type: 'extension_ui_request', id: 's-1', method: 'setStatus', statusKey: 'lsp', statusText: 'ok' }))
    const socket = fakeSocket(1)
    bridge['onOpen'](socket)
    const initial = JSON.parse(socket.lines[0]) as { type: string; sessions: { status: string }[] }
    expect(initial.type).toBe('sessions')
    expect(initial.sessions[0].status).toBe('busy')

    bridge['onText'](socket, JSON.stringify({ type: 'attach', id: remote.id }))
    const replayed = socket.lines.map((l) => JSON.parse(l) as { type: string; method?: string }).filter((f) => f.type === 'extension_ui_request')
    expect(replayed).toEqual([])
  })

  it('ui_response from phone answers dialog once and notifies others', () => {
    const host = fakeHost()
    const { bridge } = sharedBridge([host])
    const remote = [...bridge['sessions'].values()][0]
    remote.tap(JSON.stringify({ type: 'extension_ui_request', id: 'ui-9', method: 'confirm', title: 'run?' }))
    const phone = fakeSocket(1)
    const desktop = fakeSocket(2)
    bridge['onText'](phone, JSON.stringify({ type: 'attach', id: remote.id }))
    bridge['onText'](desktop, JSON.stringify({ type: 'attach', id: remote.id }))
    bridge['onText'](phone, JSON.stringify({ type: 'ui_response', id: 'ui-9', answer: { confirmed: true } }))
    const answered = desktop.lines.map((l) => JSON.parse(l) as { type: string }).find((f) => f.type === 'ui_answered')
    expect(answered).toBeDefined()
    expect((host as unknown as { respondUiCalls: unknown[] }).respondUiCalls).toEqual([['ui-9', { confirmed: true }]])
    bridge['onText'](phone, JSON.stringify({ type: 'ui_response', id: 'ui-9', answer: { confirmed: true } }))
    expect(JSON.parse(phone.lines[phone.lines.length - 1])).toMatchObject({ type: 'error' })
  })

  it('answerUiFromPc closes the phone card and clears the pending ui', () => {
    const host = fakeHost()
    const { bridge } = sharedBridge([host])
    const remote = [...bridge['sessions'].values()][0]
    remote.tap(JSON.stringify({ type: 'extension_ui_request', id: 'ui-5', method: 'confirm', title: 'run?' }))
    const phone = fakeSocket(1)
    bridge['onText'](phone, JSON.stringify({ type: 'attach', id: remote.id }))
    phone.lines.length = 0

    expect(bridge.answerUiFromPc('host-1', 'ui-5')).toBe(true)
    const answered = phone.lines.map((l) => JSON.parse(l) as { type: string; by?: string }).find((f) => f.type === 'ui_answered')
    expect(answered).toMatchObject({ type: 'ui_answered', id: 'ui-5', by: 'pc' })
    const sessions = phone.lines.map((l) => JSON.parse(l) as { type: string; sessions?: { status: string }[] }).find((f) => f.type === 'sessions')
    expect(sessions?.sessions?.[0].status).not.toBe('question')

    expect(bridge.answerUiFromPc('host-1', 'ui-5')).toBe(false)
    expect(bridge.answerUiFromPc('no-such-host', 'ui-5')).toBe(false)
  })

  it('telegram toggle from phone updates the host flag (default off, включается явно)', () => {
    const host = fakeHost()
    const { bridge } = sharedBridge([host])
    const remote = [...bridge['sessions'].values()][0]
    expect(remote.host.telegramEnabled).toBe(false)
    const socket = fakeSocket(1)
    bridge['onText'](socket, JSON.stringify({ type: 'attach', id: remote.id }))
    bridge['onText'](socket, JSON.stringify({ type: 'telegram', enabled: true }))
    expect(remote.host.telegramEnabled).toBe(true)
    bridge['onText'](socket, JSON.stringify({ type: 'telegram', enabled: false }))
    expect(remote.host.telegramEnabled).toBe(false)
    expect(bridge.telegramEnabledFor(remote.host.id)).toBe(false)
  })

  it('telegram toggle from PC works for unshared session (независимо от remote)', () => {
    const host = fakeHost()
    const { bridge } = bridgeWith([host])
    expect(bridge.setTelegramEnabledByHost(host.id, true)).toBe(true)
    expect(host.telegramEnabled).toBe(true)
    expect(bridge.telegramEnabledFor(host.id)).toBe(true)
    expect(bridge.setTelegramEnabledByHost(host.id, false)).toBe(true)
    expect(bridge.telegramEnabledFor(host.id)).toBe(false)
  })

  it('setTelegramEnabledByHost unknown host → false', () => {
    const { bridge } = bridgeWith([])
    expect(bridge.setTelegramEnabledByHost('no-such-host', true)).toBe(false)
  })

  it('telegramEnabledFor для неизвестной сессии — false (не слать уведомления)', () => {
    const { bridge } = bridgeWith([])
    expect(bridge.telegramEnabledFor('no-such-host')).toBe(false)
  })

  it('visibility frames drive isPhoneVisible', () => {
    const { bridge } = bridgeWith([])
    const socket = fakeSocket(1)
    bridge['onText'](socket, JSON.stringify({ type: 'visibility', visible: true }))
    expect(bridge.isPhoneVisible()).toBe(true)
    bridge['onText'](socket, JSON.stringify({ type: 'visibility', visible: false }))
    expect(bridge.isPhoneVisible()).toBe(false)
  })

  it('agent_settled sets unread; attach and visibility+atBottom clear it', () => {
    const host = fakeHost()
    const { bridge } = sharedBridge([host])
    const remote = [...bridge['sessions'].values()][0]
    const socket = fakeSocket(1)
    bridge['onOpen'](socket)
    bridge['onText'](socket, JSON.stringify({ type: 'attach', id: remote.id }))
    expect(remote.unread).toBe(false)

    remote.tap(JSON.stringify({ type: 'agent_settled' }))
    expect(remote.unread).toBe(true)
    const frames = socket.lines.map((l) => JSON.parse(l) as { type: string; sessions?: { unread: boolean }[] }).filter((f) => f.type === 'sessions')
    expect(frames.at(-1)?.sessions?.[0].unread).toBe(true)

    bridge['onText'](socket, JSON.stringify({ type: 'attach', id: remote.id }))
    expect(remote.unread).toBe(false)

    remote.tap(JSON.stringify({ type: 'agent_end' }))
    expect(remote.unread).toBe(true)
    bridge['onText'](socket, JSON.stringify({ type: 'visibility', visible: true, atBottom: true }))
    expect(remote.unread).toBe(false)
  })

  it('phone watching the bottom while the turn settles → no unread', () => {
    const host = fakeHost()
    const { bridge } = sharedBridge([host])
    const remote = [...bridge['sessions'].values()][0]
    const socket = fakeSocket(1)
    bridge['onOpen'](socket)
    bridge['onText'](socket, JSON.stringify({ type: 'attach', id: remote.id }))
    bridge['onText'](socket, JSON.stringify({ type: 'visibility', visible: true, atBottom: true }))
    remote.tap(JSON.stringify({ type: 'agent_settled' }))
    expect(remote.unread).toBe(false)
  })

  it('unknown frame type answers with error', () => {
    const { bridge } = bridgeWith([])
    const socket = fakeSocket(1)
    bridge['onText'](socket, 'not json')
    expect(JSON.parse(socket.lines[0])).toMatchObject({ type: 'error' })
    bridge['onText'](socket, '{"type":"wat"}')
    expect(JSON.parse(socket.lines[1])).toMatchObject({ type: 'error', message: 'unknown frame type' })
  })
})

describe('RemoteSession', () => {
  it('project name is the basename of the project dir', () => {
    const host = fakeHost()
    const remote = new RemoteSession(host, () => {})
    expect(remote.projectName).toBe('api')
    expect(remote.title).toBe('fix auth')
    expect(remote.streaming).toBe(false)
  })
})
