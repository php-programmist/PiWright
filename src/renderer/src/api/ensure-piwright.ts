/** Выбор транспорта при старте renderer'а: window.piwright от preload (Electron) или
 *  WS-клиент `/rpc` (веб-режим). В WS-режиме собранный API присваивается window.piwright —
 *  весь код renderer'а остаётся транспорт-слепым; нативные диалоги заменяются браузерными
 *  (web-overrides), маркер __piwrightWeb читает api/web.ts. */
import { createPiWrightApi } from '../../../shared/piwright-api'
import { connectWsRpc } from './ws-rpc'
import { withWebOverrides } from './web-overrides'

export type TransportKind = 'preload' | 'ws'

export async function ensurePiWrightApi(): Promise<TransportKind> {
  if (window.piwright !== undefined) return 'preload'
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  const connection = await connectWsRpc(`${scheme}://${location.host}/rpc`)
  window.__piwrightWeb = true
  window.piwright = withWebOverrides(createPiWrightApi(connection.transport, connection.platform))
  return 'ws'
}
