import { describe, expect, it, vi } from 'vitest'
import type { IncomingMessage } from 'node:http'
import type { Socket } from 'node:net'
import { randomBytes } from 'node:crypto'
import { attachRpcWs } from '../src/main/remote/rpc-ws'
import { EventBroadcaster } from '../src/main/ipc/events'
import { RpcRouter } from '../src/main/ipc/router'
import type { RpcServerFrame } from '../src/shared/rpc-transport'

/** Фейковый net.Socket: собирает исходящие кадры, входящие — через push(bytes). */
function fakeSocket(): Socket & { written: Buffer[]; push(bytes: Buffer): void; closeFromPeer(): void } {
  const written: Buffer[] = []
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>()
  const socket = {
    remoteAddress: '127.0.0.1',
    written,
    on(event: string, cb: (...args: unknown[]) => void): void {
      const list = handlers.get(event) ?? []
      list.push(cb)
      handlers.set(event, list)
    },
    write(buffer: Buffer, cb?: () => void): boolean {
      written.push(buffer)
      cb?.()
      return true
    },
    destroy(): void {},
    push(bytes: Buffer): void {
      for (const cb of handlers.get('data') ?? []) cb(bytes)
    },
    closeFromPeer(): void {
      for (const cb of handlers.get('close') ?? []) cb()
    }
  }
  return socket as unknown as Socket & { written: Buffer[]; push(bytes: Buffer): void; closeFromPeer(): void }
}

/** Клиентский кадр (RFC 6455: клиент обязан маскировать; 126/127 маркеры длины). */
function encodeClientFrame(text: string): Buffer {
  const payload = Buffer.from(text, 'utf8')
  const mask = randomBytes(4)
  let head: Buffer
  if (payload.length < 126) {
    head = Buffer.from([0x81, 0x80 | payload.length])
  } else if (payload.length <= 0xffff) {
    head = Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 0xff])
  } else {
    head = Buffer.alloc(10)
    head[0] = 0x81
    head[1] = 0x80 | 127
    head.writeBigUInt64BE(BigInt(payload.length), 2)
  }
  const masked = Buffer.from(payload)
  for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4]
  return Buffer.concat([head, mask, masked])
}

/** Разбор серверных кадров (без маски) из накопленных буферов; не-текстовые (close/ping) — мимо. */
function decodeServerFrames(written: Buffer[]): RpcServerFrame[] {
  const buffer = Buffer.concat(written)
  const frames: RpcServerFrame[] = []
  let offset = 0
  while (offset + 2 <= buffer.length) {
    const b0 = buffer[offset]
    const b1 = buffer[offset + 1]
    const opcode = b0 & 0x0f
    let length = b1 & 0x7f
    offset += 2
    if (length === 126) {
      length = buffer.readUInt16BE(offset)
      offset += 2
    } else if (length === 127) {
      length = Number(buffer.readBigUInt64BE(offset))
      offset += 8
    }
    if (opcode === 0x1) frames.push(JSON.parse(buffer.subarray(offset, offset + length).toString('utf8')) as RpcServerFrame)
    offset += length
  }
  return frames
}

function setup(): {
  router: RpcRouter
  events: EventBroadcaster
  socket: ReturnType<typeof fakeSocket>
  frames: () => RpcServerFrame[]
  send: (text: string) => void
} {
  const router = new RpcRouter()
  const events = new EventBroadcaster()
  const rpc = attachRpcWs({ router, events, platform: 'win32', appVersion: '9.9.9' })
  const socket = fakeSocket()
  rpc.upgrade({} as IncomingMessage, socket)
  return {
    router,
    events,
    socket,
    frames: () => decodeServerFrames(socket.written),
    send: (text: string) => socket.push(encodeClientFrame(text))
  }
}

describe('attachRpcWs', () => {
  it('sends hello with platform and version on open', () => {
    const { frames } = setup()
    expect(frames()).toEqual([{ t: 'hello', platform: 'win32', version: '9.9.9' }])
  })

  it('dispatches invoke to the router and answers with result', async () => {
    const { router, send, frames } = setup()
    router.handle('test:echo', (value: unknown) => value)
    send(JSON.stringify({ t: 'invoke', id: 7, channel: 'test:echo', args: ['hi'] }))
    await vi.waitFor(() => {
      expect(frames().some((f) => f.t === 'result')).toBe(true)
    })
    expect(frames()).toContainEqual({ t: 'result', id: 7, ok: true, value: 'hi' })
  })

  it('answers ok:false with the error message when the handler throws', async () => {
    const { router, send, frames } = setup()
    router.handle('test:boom', () => {
      throw new Error('boom')
    })
    send(JSON.stringify({ t: 'invoke', id: 1, channel: 'test:boom', args: [] }))
    await vi.waitFor(() => {
      expect(frames().some((f) => f.t === 'result')).toBe(true)
    })
    expect(frames()).toContainEqual({ t: 'result', id: 1, ok: false, error: 'boom' })
  })

  it('answers ok:false for unknown channels', async () => {
    const { send, frames } = setup()
    send(JSON.stringify({ t: 'invoke', id: 2, channel: 'test:missing', args: [] }))
    await vi.waitFor(() => {
      expect(frames().some((f) => f.t === 'result')).toBe(true)
    })
    expect(frames()).toContainEqual({ t: 'result', id: 2, ok: false, error: "No handler registered for 'test:missing'" })
  })

  it('broadcasts event bus messages to connected clients', () => {
    const { events, send, frames } = setup()
    send(JSON.stringify({ t: 'invoke', id: 3, channel: 'whatever', args: [] }))
    events.emit('pi:status', { hostId: 'h1' })
    events.emit('scheduled:changed')
    const list = frames()
    expect(list).toContainEqual({ t: 'event', channel: 'pi:status', value: { hostId: 'h1' } })
    expect(list).toContainEqual({ t: 'event', channel: 'scheduled:changed', value: null })
  })

  it('ignores malformed and non-invoke frames without crashing', () => {
    const { send, frames } = setup()
    send('not json')
    send(JSON.stringify({ t: 'event', channel: 'x' }))
    send(JSON.stringify({ t: 'invoke', channel: 'no-id', args: [] }))
    // invoke без id получает result с id:null — осмысленных (числовой id) ответов нет.
    expect(frames().every((f) => f.t !== 'result' || f.id === null)).toBe(true)
  })

  it('dispose closes connections and detaches the event sink', () => {
    const router = new RpcRouter()
    const events = new EventBroadcaster()
    const rpc = attachRpcWs({ router, events, platform: 'linux', appVersion: '1' })
    const socket = fakeSocket()
    rpc.upgrade({} as IncomingMessage, socket)
    rpc.dispose()
    events.emit('pi:status', {})
    expect(decodeServerFrames(socket.written).every((f) => f.t === 'hello')).toBe(true)
  })

  it('accepts frames larger than the phone limit (attachments base64)', async () => {
    const { router, send, frames } = setup()
    router.handle('test:len', (value: unknown) => (value as string).length)
    const big = 'x'.repeat(3 * 1024 * 1024)
    send(JSON.stringify({ t: 'invoke', id: 5, channel: 'test:len', args: [big] }))
    await vi.waitFor(() => {
      expect(frames().some((f) => f.t === 'result')).toBe(true)
    })
    expect(frames()).toContainEqual({ t: 'result', id: 5, ok: true, value: big.length })
  })
})
