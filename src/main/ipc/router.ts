/** Транспорт-агностичный диспетчер каналов: реестр «канал → обработчик». Наполняется в
 *  register.ts, привязывается к проводам в адаптерах: attachIpcServer (ipcMain) и
 *  rpc-ws (WebSocket). Контракт каналов — src/shared/ipc-contracts.ts. */
export type RpcHandler = (...args: unknown[]) => unknown | Promise<unknown>

export class RpcRouter {
  private readonly handlers = new Map<string, RpcHandler>()

  handle(channel: string, handler: RpcHandler): void {
    if (this.handlers.has(channel)) throw new Error(`Handler already registered for ${channel}`)
    this.handlers.set(channel, handler)
  }

  has(channel: string): boolean {
    return this.handlers.has(channel)
  }

  channels(): Iterable<string> {
    return this.handlers.keys()
  }

  /** Вызов канала; неизвестный канал или ошибка обработчика — исключение (как ipcMain.handle). */
  async invoke(channel: string, args: unknown[]): Promise<unknown> {
    const handler = this.handlers.get(channel)
    if (handler === undefined) throw new Error(`No handler registered for '${channel}'`)
    return handler(...args)
  }
}
