import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RemoteBridge } from '../src/main/remote/bridge'
import { RemoteAuth } from '../src/main/remote/auth'
import type { PiHost } from '../src/main/pi/pi-host'
import type { NotificationSettings, Settings } from '../src/shared/ipc-contracts'
import { DEFAULT_SETTINGS } from '../src/main/settings/settings'

const PORT = 7690

/** Состояние фейкового сервера: порты в busyPorts не поднимаются, hold задерживает старт. */
const state = vi.hoisted(() => ({
  busyPorts: new Set<number>(),
  attempts: [] as number[],
  instances: [] as { requestedPort: number; port: number; stopped: boolean }[],
  hold: null as Promise<void> | null
}))

vi.mock('../src/main/remote/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/main/remote/server')>()
  class FakeRemoteWebServer {
    port = 0
    stopped = false
    readonly record = { requestedPort: 0, port: 0, stopped: false }

    constructor(private readonly requestedPort: number) {
      this.record.requestedPort = requestedPort
      state.instances.push(this.record)
    }

    async start(): Promise<{ ok: boolean; error: string | null }> {
      state.attempts.push(this.requestedPort)
      if (state.hold !== null) await state.hold
      if (state.busyPorts.has(this.requestedPort)) return { ok: false, error: 'EADDRINUSE' }
      this.port = this.requestedPort
      this.record.port = this.requestedPort
      return { ok: true, error: null }
    }

    stop(): void {
      this.stopped = true
      this.record.stopped = true
    }
  }
  return { ...actual, RemoteWebServer: FakeRemoteWebServer }
})

function bridgeWith(): { bridge: RemoteBridge; apply: (remote: Partial<NotificationSettings['remote']>) => void } {
  let remote: NotificationSettings['remote'] = { ...DEFAULT_SETTINGS.notifications.remote }
  const getSettings = (): Settings => ({
    ...DEFAULT_SETTINGS,
    notifications: { ...DEFAULT_SETTINGS.notifications, remote }
  })
  const bridge = new RemoteBridge(getSettings, { get: () => null } as unknown as PiHost, new RemoteAuth('123456'), null)
  return {
    bridge,
    apply: (patch) => {
      remote = { ...remote, ...patch }
      bridge.applySettings(getSettings())
    }
  }
}

describe('RemoteBridge — ретрай старта remote-сервера', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    state.busyPorts.clear()
    state.attempts.length = 0
    state.instances.length = 0
    state.hold = null
  })

  it('порт занят — старт повторяется с экспоненциальным backoff и сервер поднимается сам', async () => {
    const { bridge, apply } = bridgeWith()
    state.busyPorts.add(PORT)
    apply({ enabled: true, port: PORT })
    await vi.advanceTimersByTimeAsync(0)

    expect(bridge.connectionInfo().running).toBe(false)
    expect(bridge.connectionInfo().error).toBe('EADDRINUSE')
    expect(state.attempts).toEqual([PORT])

    await vi.advanceTimersByTimeAsync(999)
    expect(state.attempts).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(state.attempts).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(2000)
    expect(state.attempts).toHaveLength(3)

    state.busyPorts.delete(PORT)
    await vi.advanceTimersByTimeAsync(4000)
    expect(bridge.connectionInfo().running).toBe(true)
    expect(bridge.connectionInfo().error).toBeNull()
    expect(bridge.connectionInfo().port).toBe(PORT)
  })

  it('backoff упирается в потолок 30 с и не растёт дальше', async () => {
    const { apply } = bridgeWith()
    state.busyPorts.add(PORT)
    apply({ enabled: true, port: PORT })
    await vi.advanceTimersByTimeAsync(0)

    // 1+2+4+8+16+30 с = 61 с → попытки 2..7
    await vi.advanceTimersByTimeAsync(61_000)
    expect(state.attempts).toHaveLength(7)
    await vi.advanceTimersByTimeAsync(29_999)
    expect(state.attempts).toHaveLength(7)
    await vi.advanceTimersByTimeAsync(1)
    expect(state.attempts).toHaveLength(8)
  })

  it('retryNow стартует немедленно и сбрасывает backoff', async () => {
    const { bridge, apply } = bridgeWith()
    state.busyPorts.add(PORT)
    apply({ enabled: true, port: PORT })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(state.attempts).toHaveLength(2)

    expect(bridge.retryNow()).toBe(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(state.attempts).toHaveLength(3)

    await vi.advanceTimersByTimeAsync(999)
    expect(state.attempts).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(state.attempts).toHaveLength(4)
  })

  it('retryNow ничего не делает на выключенном remote и на уже слушающем порту', async () => {
    const { bridge, apply } = bridgeWith()
    apply({ enabled: false, port: PORT })
    expect(bridge.retryNow()).toBe(false)

    apply({ enabled: true, port: PORT })
    await vi.advanceTimersByTimeAsync(0)
    expect(bridge.connectionInfo().running).toBe(true)
    expect(bridge.retryNow()).toBe(false)
    expect(state.attempts).toHaveLength(1)
  })

  it('выключение тумблером снимает сервер и гасит ретраи', async () => {
    const { bridge, apply } = bridgeWith()
    state.busyPorts.add(PORT)
    apply({ enabled: true, port: PORT })
    await vi.advanceTimersByTimeAsync(5000)
    expect(state.attempts.length).toBeGreaterThan(1)

    apply({ enabled: false })
    expect(bridge.connectionInfo().error).toBeNull()
    const attempts = state.attempts.length
    await vi.advanceTimersByTimeAsync(120_000)
    expect(state.attempts).toHaveLength(attempts)
  })

  it('смена настроек во время старта не возвращает сервер к жизни', async () => {
    const { bridge, apply } = bridgeWith()
    let release: () => void = () => {}
    state.hold = new Promise<void>((resolve) => {
      release = resolve
    })
    apply({ enabled: true, port: PORT })
    await vi.advanceTimersByTimeAsync(0)
    expect(state.instances).toHaveLength(1)

    apply({ enabled: false })
    release()
    await vi.advanceTimersByTimeAsync(0)

    expect(bridge.connectionInfo().running).toBe(false)
    expect(state.instances[0].stopped).toBe(true)
  })
})
