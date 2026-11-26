/** Транспорт-агностичный RPC: контракт каналов (ipc-contracts.ts) не зависит от провода.
 *  Два транспорта: IPC (preload ↔ ipcMain) и WebSocket (браузер ↔ remote/headless-сервер).
 *  Кадры WS — JSON-текст: запрос/ответ/событие + hello с платформой сервера. */

/** Клиентский транспорт (сторона renderer'а). subscribe — push-события main. */
export interface RpcTransport {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>
  subscribe(channel: string, cb: (value: unknown) => void): () => void
}

export type RpcPlatform = 'win32' | 'darwin' | 'linux'

/** Сервер → клиент, сразу после открытия соединения. */
export interface RpcHelloFrame {
  t: 'hello'
  platform: RpcPlatform
  version: string
}

/** Клиент → сервер. */
export interface RpcRequestFrame {
  t: 'invoke'
  id: number
  channel: string
  args: unknown[]
}

/** Сервер → клиент, ответ на invoke. */
export type RpcResultFrame =
  | { t: 'result'; id: number; ok: true; value: unknown }
  | { t: 'result'; id: number; ok: false; error: string }

/** Сервер → клиент, push-событие (аналог webContents.send; payload один или отсутствует). */
export interface RpcEventFrame {
  t: 'event'
  channel: string
  value: unknown
}

export type RpcServerFrame = RpcHelloFrame | RpcResultFrame | RpcEventFrame
export type RpcClientFrame = RpcRequestFrame
