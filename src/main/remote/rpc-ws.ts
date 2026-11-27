/** WS-транспорт RPC (серверная сторона): путь `/rpc` remote-сервера. Кадры — JSON
 *  (src/shared/rpc-transport.ts): invoke → result, события шины (EventBroadcaster) → event.
 *  Переиспользует самописный WsConnection (ws.ts) с увеличенным лимитом кадра (вложения base64). */
import type { IncomingMessage } from 'node:http'
import type { Socket } from 'node:net'
import type { RpcEventFrame, RpcHelloFrame, RpcPlatform, RpcResultFrame } from '../../shared/rpc-transport'
import type { EventBroadcaster } from '../ipc/events'
import type { RpcRouter } from '../ipc/router'
import { WsConnection } from './ws'
import { errorMessage } from '../../shared/errors'

/** Лимит кадра запроса: вложения канбан/промптов уходят base64 (2 МиБ ws.ts мало). */
export const RPC_MAX_MESSAGE_BYTES = 64 * 1024 * 1024

export type RpcUpgradeHandler = (req: IncomingMessage, socket: Socket) => void

export interface RpcWsOptions {
  router: RpcRouter
  events: EventBroadcaster
  platform: RpcPlatform
  appVersion: string
}

export interface RpcWsAttachment {
  upgrade: RpcUpgradeHandler
  /** Снять event-sink и закрыть соединения (остановка сервера). */
  dispose(): void
}

export function attachRpcWs(options: RpcWsOptions): RpcWsAttachment {
  const connections = new Set<WsConnection>()
  let nextSeq = 1

  const removeSink = options.events.addSink((channel, ...values) => {
    const frame: RpcEventFrame = {
      t: 'event',
      channel,
      value: values.length > 0 ? (values[0] ?? null) : null
    }
    const text = JSON.stringify(frame)
    for (const connection of connections) connection.send(text)
  })

  const hello: RpcHelloFrame = { t: 'hello', platform: options.platform, version: options.appVersion }

  const upgrade: RpcUpgradeHandler = (_req, socket) => {
    const connection = new WsConnection(
      nextSeq++,
      socket,
      (text) => {
        void handleText(connection, text)
      },
      () => connections.delete(connection),
      RPC_MAX_MESSAGE_BYTES
    )
    connections.add(connection)
    connection.send(JSON.stringify(hello))
  }

  async function handleText(connection: WsConnection, text: string): Promise<void> {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      return
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return
    const frame = parsed as Record<string, unknown>
    if (frame['t'] !== 'invoke') return
    const id = typeof frame['id'] === 'number' ? frame['id'] : null
    const channel = frame['channel']
    if (id === null || typeof channel !== 'string') {
      connection.send(JSON.stringify({ t: 'result', id: null, ok: false, error: 'Malformed request' }))
      return
    }
    const args = Array.isArray(frame['args']) ? frame['args'] : []
    try {
      const value = await options.router.invoke(channel, args)
      const result: RpcResultFrame = { t: 'result', id, ok: true, value: value ?? null }
      connection.send(JSON.stringify(result))
    } catch (err) {
      const result: RpcResultFrame = {
        t: 'result',
        id,
        ok: false,
        error: errorMessage(err)
      }
      connection.send(JSON.stringify(result))
    }
  }

  return {
    upgrade,
    dispose(): void {
      removeSink()
      for (const connection of connections) connection.close()
      connections.clear()
    }
  }
}
