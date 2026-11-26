/** Preload = IPC-транспорт: contextBridge + ipcRenderer поверх общей фабрики API
 *  (src/shared/piwright-api.ts). Маппинг «метод → канал» живёт там, здесь только провод. */
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import { createPiWrightApi } from '../shared/piwright-api'
import type { RpcPlatform, RpcTransport } from '../shared/rpc-transport'

const transport: RpcTransport = {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  subscribe: (channel, cb) => {
    const listener = (_event: IpcRendererEvent, value: unknown): void => cb(value)
    ipcRenderer.on(channel, listener)
    return () => {
      ipcRenderer.removeListener(channel, listener)
    }
  }
}

contextBridge.exposeInMainWorld('piwright', createPiWrightApi(transport, process.platform as RpcPlatform))
