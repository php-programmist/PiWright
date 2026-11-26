import { describe, expect, it } from 'vitest'
import { connectWsRpc } from '../src/renderer/src/api/ws-rpc'
import type { WsLike } from '../src/renderer/src/api/ws-rpc'

/** Фейковый браузерный WebSocket: тест управляет доставкой кадров вручную. */
function fakeSocket(): WsLike & {
  outgoing: string[]
  serverSend(text: string): void
  closeFromServer(): void
  fail(): void
} {
  const self = {
    outgoing: [] as string[],
    send(data: string): void {
      self.outgoing.push(data)
    },
    close(): void {},
    onopen: null as (() => void) | null,
    onmessage: null as ((event: { data: unknown }) => void) | null,
    onclose: null as (() => void) | null,
    onerror: null as (() => void) | null,
    serverSend(text: string): void {
      self.onmessage?.({ data: text })
    },
    closeFromServer(): void {
      self.onclose?.()
    },
    fail(): void {
      self.onerror?.()
    }
  }
  return self
}

function hello(): string {
  return JSON.stringify({ t: 'hello', platform: 'linux', version: '1.2.3' })
}

describe('connectWsRpc', () => {
  it('resolves after hello with platform and version', async () => {
    const socket = fakeSocket()
    const pending = connectWsRpc('ws://x/rpc', () => socket)
    socket.serverSend(hello())
    const connection = await pending
    expect(connection.platform).toBe('linux')
    expect(connection.version).toBe('1.2.3')
  })

  it('rejects when the socket errors or closes before hello', async () => {
    const socket = fakeSocket()
    const pending = connectWsRpc('ws://x/rpc', () => socket)
    socket.fail()
    await expect(pending).rejects.toThrow('WebSocket error')

    const socket2 = fakeSocket()
    const pending2 = connectWsRpc('ws://x/rpc', () => socket2)
    socket2.closeFromServer()
    await expect(pending2).rejects.toThrow('WebSocket closed before hello')
  })

  it('invoke sends a numbered frame and resolves on result', async () => {
    const socket = fakeSocket()
    const pending = connectWsRpc('ws://x/rpc', () => socket)
    socket.serverSend(hello())
    const { transport } = await pending
    const call = transport.invoke('git:status', { dir: '/x' }, 2)
    await Promise.resolve()
    expect(socket.outgoing).toEqual([JSON.stringify({ t: 'invoke', id: 1, channel: 'git:status', args: [{ dir: '/x' }, 2] })])
    socket.serverSend(JSON.stringify({ t: 'result', id: 1, ok: true, value: { ok: true, error: null } }))
    await expect(call).resolves.toEqual({ ok: true, error: null })
  })

  it('invoke rejects on ok:false with the server error text', async () => {
    const socket = fakeSocket()
    const pending = connectWsRpc('ws://x/rpc', () => socket)
    socket.serverSend(hello())
    const { transport } = await pending
    const call = transport.invoke('sessions:new', 'bad')
    await Promise.resolve()
    socket.serverSend(JSON.stringify({ t: 'result', id: 1, ok: false, error: 'Invalid project' }))
    await expect(call).rejects.toThrow('Invalid project')
  })

  it('events fan out to subscribers until unsubscribed', async () => {
    const socket = fakeSocket()
    const pending = connectWsRpc('ws://x/rpc', () => socket)
    socket.serverSend(hello())
    const { transport } = await pending
    const seen: unknown[] = []
    const off = transport.subscribe('pi:status', (value) => seen.push(value))
    socket.serverSend(JSON.stringify({ t: 'event', channel: 'pi:status', value: { hostId: 'h1' } }))
    off()
    socket.serverSend(JSON.stringify({ t: 'event', channel: 'pi:status', value: { hostId: 'h2' } }))
    expect(seen).toEqual([{ hostId: 'h1' }])
  })

  it('rejects pending and new invokes after the connection drops', async () => {
    const socket = fakeSocket()
    const pending = connectWsRpc('ws://x/rpc', () => socket)
    socket.serverSend(hello())
    const { transport, close } = await pending
    const call = transport.invoke('settings:get')
    await Promise.resolve()
    socket.closeFromServer()
    await expect(call).rejects.toThrow('RPC connection is closed')
    await expect(transport.invoke('settings:get')).rejects.toThrow('RPC connection is closed')
    close()
  })

  it('ignores malformed and unknown frames', async () => {
    const socket = fakeSocket()
    const pending = connectWsRpc('ws://x/rpc', () => socket)
    socket.serverSend('garbage')
    socket.serverSend(JSON.stringify({ t: 'result', id: 99, ok: true, value: 1 }))
    socket.serverSend(hello())
    await expect(pending).resolves.toBeDefined()
  })
})
