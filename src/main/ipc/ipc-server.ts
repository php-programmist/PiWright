/** Привязка роутера к Electron IPC: каждый канал роутера становится ipcMain.handle.
 *  Fire-and-forget каналы (term:input/term:resize) унифицированы до invoke без результата. */
import type { IpcMain } from 'electron'
import type { RpcRouter } from './router'

export function attachIpcServer(ipcMain: IpcMain, router: RpcRouter): void {
  for (const channel of router.channels()) {
    ipcMain.handle(channel, (_event, ...args: unknown[]) => router.invoke(channel, args))
  }
}
