import { describe, expect, it, vi } from 'vitest'
import { EventBroadcaster } from '../src/main/ipc/events'
import { attachIpcServer } from '../src/main/ipc/ipc-server'
import { RpcRouter } from '../src/main/ipc/router'

describe('RpcRouter', () => {
  it('dispatches args to the handler and resolves the value', async () => {
    const router = new RpcRouter()
    router.handle('test:sum', (a: unknown, b: unknown) => (a as number) + (b as number))
    await expect(router.invoke('test:sum', [2, 3])).resolves.toBe(5)
  })

  it('supports async handlers', async () => {
    const router = new RpcRouter()
    router.handle('test:async', async () => 'done')
    await expect(router.invoke('test:async', [])).resolves.toBe('done')
  })

  it('throws on unknown channel', async () => {
    const router = new RpcRouter()
    await expect(router.invoke('test:missing', [])).rejects.toThrow("No handler registered for 'test:missing'")
  })

  it('rejects duplicate registration', () => {
    const router = new RpcRouter()
    router.handle('test:x', () => null)
    expect(() => router.handle('test:x', () => null)).toThrow('already registered')
  })

  it('propagates handler errors', async () => {
    const router = new RpcRouter()
    router.handle('test:boom', () => {
      throw new Error('boom')
    })
    await expect(router.invoke('test:boom', [])).rejects.toThrow('boom')
  })

  it('lists registered channels', () => {
    const router = new RpcRouter()
    router.handle('test:a', () => null)
    router.handle('test:b', () => null)
    expect([...router.channels()].sort()).toEqual(['test:a', 'test:b'])
    expect(router.has('test:a')).toBe(true)
    expect(router.has('test:c')).toBe(false)
  })
})

describe('attachIpcServer', () => {
  it('binds every router channel as ipcMain.handle and dispatches variadic args', async () => {
    const registered = new Map<string, (...args: unknown[]) => unknown>()
    const ipcMain = {
      handle: (channel: string, fn: (...args: unknown[]) => unknown): void => {
        registered.set(channel, fn)
      },
      on: vi.fn()
    }
    const router = new RpcRouter()
    router.handle('test:echo', (value: unknown) => value)
    router.handle('test:add', (a: unknown, b: unknown) => (a as number) + (b as number))
    attachIpcServer(ipcMain as never, router)
    expect(registered.size).toBe(2)
    await expect(registered.get('test:echo')!(null, 'hi')).resolves.toBe('hi')
    await expect(registered.get('test:add')!(null, 1, 2)).resolves.toBe(3)
  })
})

describe('EventBroadcaster', () => {
  it('fans out to all sinks with variadic payloads', () => {
    const bus = new EventBroadcaster()
    const seen: Array<{ channel: string; values: unknown[] }> = []
    bus.addSink((channel, ...values) => seen.push({ channel, values }))
    const second: string[] = []
    const remove = bus.addSink((channel) => second.push(channel))
    bus.emit('ch:a', { x: 1 })
    bus.emit('ch:b')
    expect(seen).toEqual([
      { channel: 'ch:a', values: [{ x: 1 }] },
      { channel: 'ch:b', values: [] }
    ])
    expect(second).toEqual(['ch:a', 'ch:b'])
    remove()
    bus.emit('ch:c')
    expect(second).toEqual(['ch:a', 'ch:b'])
  })
})
