import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, safeStorage, screen } from 'electron'
import { FILES_CHANGED_CHANNEL, PI_EVENT_CHANNEL, PI_STATUS_CHANNEL, TERM_DATA_CHANNEL, TERM_EXIT_CHANNEL } from '../shared/ipc-contracts'
import { registerIpc } from './ipc/register'
import { GitService } from './git/git-service'
import { FileService } from './files/file-service'
import { TerminalService } from './terminal/terminal-service'
import { startAutoUpdater } from './updater'
import { PiHost } from './pi/pi-host'
import { SettingsService } from './settings/settings'
import { loadWindowState, saveWindowState } from './window-state'
import { TelegramTokenStore } from './notifications/token-store'
import { NotificationHub } from './notifications/hub'
import { RemoteAuth, generatePin } from './remote/auth'
import { RemoteBridge } from './remote/bridge'

let mainWindow: BrowserWindow | null = null
let piHost: PiHost | null = null
let gitService: GitService | null = null
let fileService: FileService | null = null
let terminalService: TerminalService | null = null
let bridge: RemoteBridge | null = null
let hub: NotificationHub | null = null
let windowStatePath = ''

function createWindow(bg: string): void {
  const state = loadWindowState(windowStatePath, screen.getPrimaryDisplay().workArea)
  mainWindow = new BrowserWindow({
    width: state.width,
    height: state.height,
    title: 'PiWright',
    backgroundColor: bg,
    icon: app.isPackaged ? join(process.resourcesPath, 'icon.ico') : join(__dirname, '../../build/icon.ico'),
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  if (state.maximized) mainWindow.maximize()
  mainWindow.on('close', () => {
    saveWindowState(windowStatePath, mainWindow as BrowserWindow)
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  windowStatePath = join(app.getPath('userData'), 'window-state.json')
  const settings = new SettingsService(join(app.getPath('userData'), 'settings.json'))
  gitService = new GitService(() => settings.get())
  fileService = new FileService({
    onChanged: (project, path) => mainWindow?.webContents.send(FILES_CHANGED_CHANNEL, { project, path })
  })
  const tokenStore = new TelegramTokenStore(
    app.getPath('userData'),
    (value) => safeStorage.encryptString(value),
    (buffer) => safeStorage.decryptString(buffer)
  )
  piHost = new PiHost(
    () => settings.get(),
    {
      onStatus: (status) => mainWindow?.webContents.send(PI_STATUS_CHANNEL, status),
      onEvent: (message) => {
        mainWindow?.webContents.send(PI_EVENT_CHANNEL, message)
        hub?.onEvent(message)
      }
    }
  )
  const auth = new RemoteAuth(generatePin())
  bridge = new RemoteBridge(() => settings.get(), piHost, auth)
  bridge.applySettings(settings.get())
  hub = new NotificationHub(() => settings.get(), tokenStore, piHost, () => bridge)
  terminalService = new TerminalService({
    onData: (id, data) => mainWindow?.webContents.send(TERM_DATA_CHANNEL, { id, data }),
    onExit: (id, code) => mainWindow?.webContents.send(TERM_EXIT_CHANNEL, { id, code })
  })
  registerIpc(ipcMain, settings, piHost, gitService, fileService, terminalService, {
    tokenStore,
    bridge,
    onSettingsChanged: (next) => bridge?.applySettings(next)
  })
  startAutoUpdater(() => settings.get().updateUrl)
  const bg = settings.get().theme === 'light' ? '#f5f6f8' : '#14161a'
  createWindow(bg)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(bg)
  })
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('will-quit', () => {
  piHost?.disposeAll()
  fileService?.dispose()
  terminalService?.disposeAll()
})
