import { describe, expect, it } from 'vitest'
import { createPiWrightApi } from '../src/shared/piwright-api'
import { GIT_LOG_CHANNEL, PI_STATUS_CHANNEL, SESSION_PROMPT_CHANNEL, SETTINGS_GET_CHANNEL, TERM_INPUT_CHANNEL } from '../src/shared/ipc-contracts'
import type { RpcTransport } from '../src/shared/rpc-transport'

function recordingTransport(): RpcTransport & {
  calls: Array<{ channel: string; args: unknown[] }>
  emit(channel: string, value: unknown): void
} {
  const calls: Array<{ channel: string; args: unknown[] }> = []
  const subscribers = new Map<string, Set<(value: unknown) => void>>()
  return {
    calls,
    invoke: async (channel, ...args) => {
      calls.push({ channel, args })
      return { ok: true }
    },
    subscribe: (channel, cb) => {
      const set = subscribers.get(channel) ?? new Set()
      set.add(cb)
      subscribers.set(channel, set)
      return () => {
        set.delete(cb)
      }
    },
    emit: (channel, value) => {
      for (const cb of subscribers.get(channel) ?? []) cb(value)
    }
  }
}

describe('createPiWrightApi', () => {
  it('maps methods to channels with the same arg order as the preload contract', async () => {
    const transport = recordingTransport()
    const api = createPiWrightApi(transport, 'win32')
    await api.getSettings()
    await api.prompt('h1', 'text', ['a.png'], 'steer')
    await api.prompt('h1', 'text')
    await api.gitLog({ kind: 'native', dir: 'd' })
    await api.gitLog({ kind: 'native', dir: 'd' }, 3, { query: 'fix' })
    expect(transport.calls.map((c) => c.channel)).toEqual([
      SETTINGS_GET_CHANNEL,
      SESSION_PROMPT_CHANNEL,
      SESSION_PROMPT_CHANNEL,
      GIT_LOG_CHANNEL,
      GIT_LOG_CHANNEL
    ])
    expect(transport.calls[1].args).toEqual(['h1', 'text', ['a.png'], 'steer'])
    // Нормализация опциональных аргументов — как в прежнем preload.
    expect(transport.calls[2].args).toEqual(['h1', 'text', [], undefined])
    expect(transport.calls[3].args).toEqual([{ kind: 'native', dir: 'd' }, 0, null])
    expect(transport.calls[4].args).toEqual([{ kind: 'native', dir: 'd' }, 3, { query: 'fix' }])
  })

  it('typed results pass through from the transport', async () => {
    const transport = recordingTransport()
    const api = createPiWrightApi(transport, 'darwin')
    expect(api.platform).toBe('darwin')
    await expect(api.getSettings()).resolves.toEqual({ ok: true })
  })

  it('subscriptions route channel events and support unsubscribe', () => {
    const transport = recordingTransport()
    const api = createPiWrightApi(transport, 'linux')
    const seen: unknown[] = []
    const off = api.onPiStatus((status) => seen.push(status))
    transport.emit(PI_STATUS_CHANNEL, { hostId: 'h1' })
    off()
    transport.emit(PI_STATUS_CHANNEL, { hostId: 'h2' })
    expect(seen).toEqual([{ hostId: 'h1' }])
  })

  it('fire-and-forget term input maps to invoke and swallows errors', async () => {
    const transport = recordingTransport()
    const api = createPiWrightApi(transport, 'win32')
    api.termInput('t1', 'ls\r')
    await Promise.resolve()
    expect(transport.calls).toEqual([{ channel: TERM_INPUT_CHANNEL, args: ['t1', 'ls\r'] }])
  })
})
