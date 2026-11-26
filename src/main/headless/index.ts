/** Headless-сервер веб-режима (out/headless/index.js, чистый node — без Electron-окна):
 *  отдаёт собранный renderer (out/renderer) статикой + WS-RPC на /rpc (PIN/cookie как у
 *  remote-моста). Запуск: npm run serve (dev) или ELECTRON_RUN_AS_NODE=1 <binary>
 *  <app>/out/headless/index.js (упакованный). userData — те же каталоги, что у Electron
 *  (XDG_CONFIG_HOME на linux), настройки/проекты/сессии общие с десктопом. */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createAppContext } from '../bootstrap'
import type { IpcHost } from '../ipc/register'
import { RemoteWebServer, type RemoteWebServerListener } from '../remote/server'
import { parseArgs, readAppVersion } from './paths'

/** Заглушки dialog/shell до браузерных замен (задача 3/4): канал отвечает внятной ошибкой. */
function unavailable(what: string): never {
  throw new Error(`${what} is not available in web mode yet`)
}

const ipcHost: IpcHost = {
  appVersion: '0.0.0',
  userDataPath: '', // заполняется в main()
  showItemInFolder: () => unavailable('Reveal in folder'),
  openExternal: () => unavailable('Open external'),
  chooseDirectory: async () => ({ canceled: true, paths: [] })
}

const listener: RemoteWebServerListener = {
  onOpen: () => {},
  onText: () => {},
  onClose: () => {}
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  mkdirSync(args.userData, { recursive: true })
  ipcHost.userDataPath = args.userData
  ipcHost.appVersion = readAppVersion(__dirname)
  const context = await createAppContext({
    userDataPath: args.userData,
    appVersion: readAppVersion(__dirname),
    updateInfo: { updatedFrom: null },
    ipc: ipcHost,
    // Демон — обычный fork без ELECTRON_RUN_AS_NODE (хост и так чистый node).
    nodeHost: true
  })
  const rendererRoot = join(__dirname, '..', 'renderer')
  const server = new RemoteWebServer(
    args.port,
    context.auth,
    listener,
    () => context.settings.get().language,
    context.rpcWs.upgrade,
    rendererRoot,
    args.bindHost
  )
  const started = await server.start()
  if (!started.ok) {
    console.error(`PiWright web: failed to bind ${args.bindHost}:${args.port} — ${started.error}`)
    process.exit(1)
  }
  console.log(`PiWright web: http://${args.bindHost === '127.0.0.1' ? 'localhost' : args.bindHost}:${server.port}/ (PIN ${context.auth.groupedPin})`)
  console.log(`PiWright web: userData ${args.userData}`)

  let closing = false
  const shutdown = (signal: string): void => {
    if (closing) return
    closing = true
    console.log(`PiWright web: ${signal}, shutting down`)
    server.stop()
    void context.dispose().then(() => process.exit(0))
    setTimeout(() => process.exit(0), 5000).unref()
  }
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch((err: unknown) => {
  console.error('PiWright web: fatal —', err instanceof Error ? err.stack : String(err))
  process.exit(1)
})
