/** WS-клиент транспорта RPC (сторона renderer'а, веб-режим): кадры из shared/rpc-transport.ts.
 *  Соединение — `/rpc` того же origin (cookie авторизации браузер ставит сам). Сокет
 *  инъекцируется для тестов; по умолчанию — браузерный WebSocket. */
import type {
  RpcClientFrame,
  RpcPlatform,
  RpcServerFrame,
  RpcTransport
} from '../../../shared/rpc-transport'

/** Минимальный интерфейс сокета (структурно — браузерный WebSocket). */
export interface WsLike {
  send(data: string): void
  close(): void
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: (() => void) | null
  onerror: (() => void) | null
}

export interface WsRpcConnection {
  transport: RpcTransport
  platform: RpcPlatform
  version: string
  close(): void
}

function parseFrame(text: unknown): RpcServerFrame | null {
  if (typeof text !== 'string') return null
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const t = (parsed as Record<string, unknown>)['t']
    return t === 'hello' || t === 'result' || t === 'event' ? (parsed as RpcServerFrame) : null
  } catch {
    return null
  }
}

export function connectWsRpc(
  url: string,
  createSocket: (url: string) => WsLike = (u) => new WebSocket(u) as unknown as WsLike
): Promise<WsRpcConnection> {
  return new Promise((resolve, reject) => {
    let socket: WsLike
    try {
      socket = createSocket(url)
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
      return
    }
    const pending = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>()
    const subscribers = new Map<string, Set<(value: unknown) => void>>()
    let nextId = 1
    let settled = false
    let closed = false

    const fail = (err: Error): void => {
      if (settled) return
      settled = true
      cleanup()
      reject(err)
    }

    const drop = (): void => {
      if (!settled) {
        fail(new Error('WebSocket closed before hello'))
        return
      }
      closed = true
      const err = new Error('RPC connection is closed')
      for (const entry of pending.values()) entry.reject(err)
      pending.clear()
    }

    function cleanup(): void {
      socket.onopen = null
      socket.onmessage = null
      socket.onclose = null
      socket.onerror = null
    }

    socket.onclose = () => drop()
    socket.onerror = () => {
      if (!settled) fail(new Error('WebSocket error'))
    }
    socket.onmessage = (event) => {
      const frame = parseFrame(event.data)
      if (frame === null) return
      if (!settled) {
        if (frame.t !== 'hello') return
        settled = true
        resolve({
          platform: frame.platform,
          version: frame.version,
          close: () => {
            closed = true
            try {
              socket.close()
            } catch {
              // сокет уже мёртв
            }
          },
          transport
        })
        return
      }
      if (frame.t === 'result') {
        const entry = pending.get(frame.id)
        if (entry === undefined) return
        pending.delete(frame.id)
        if (frame.ok) entry.resolve(frame.value)
        else entry.reject(new Error(frame.error))
        return
      }
      if (frame.t === 'event') {
        const set = subscribers.get(frame.channel)
        if (set === undefined) return
        for (const cb of set) cb(frame.value)
      }
    }

    const transport: RpcTransport = {
      invoke: (channel, ...args) =>
        new Promise((resolveInvoke, rejectInvoke) => {
          if (closed) {
            rejectInvoke(new Error('RPC connection is closed'))
            return
          }
          const id = nextId++
          const request: RpcClientFrame = { t: 'invoke', id, channel, args }
          pending.set(id, { resolve: resolveInvoke, reject: rejectInvoke })
          try {
            socket.send(JSON.stringify(request))
          } catch (err) {
            pending.delete(id)
            rejectInvoke(err instanceof Error ? err : new Error(String(err)))
          }
        }),
      subscribe: (channel, cb) => {
        let set = subscribers.get(channel)
        if (set === undefined) {
          set = new Set()
          subscribers.set(channel, set)
        }
        set.add(cb)
        return () => {
          set.delete(cb)
        }
      }
    }
  })
}
