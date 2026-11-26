/** Выбор транспорта при старте renderer'а: window.piwright от preload (Electron) или
 *  WS-клиент `/rpc` (веб-режим). В WS-режиме собранный API присваивается window.piwright —
 *  весь код renderer'а остаётся транспорт-слепым. */
import { createPiWrightApi } from '../../../shared/piwright-api'
import { connectWsRpc } from './ws-rpc'

export type TransportKind = 'preload' | 'ws'

export async function ensurePiWrightApi(): Promise<TransportKind> {
  if (window.piwright !== undefined) return 'preload'
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  const connection = await connectWsRpc(`${scheme}://${location.host}/rpc`)
  window.piwright = createPiWrightApi(connection.transport, connection.platform)
  return 'ws'
}
