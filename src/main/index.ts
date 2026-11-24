import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, safeStorage, screen } from 'electron'
import { FILES_CHANGED_CHANNEL, PI_EVENT_CHANNEL, PI_STATUS_CHANNEL, SCHEDULED_CHANGED_CHANNEL, TERM_DATA_CHANNEL, TERM_EXIT_CHANNEL } from '../shared/ipc-contracts'
import { registerIpc } from './ipc/register'
import { GitService } from './git/git-service'
import { FileService } from './files/file-service'
import { KanbanService } from './kanban/kanban-service'
import { KanbanThemeService } from './kanban/kanban-theme-service'
import { TerminalService } from './terminal/terminal-service'
import { startAutoUpdater } from './updater'
import { PiHost } from './pi/pi-host'
import { LoopController } from './pi/loop-controller'
import { ScheduleService } from './schedule/schedule-service'
import { SettingsService } from './settings/settings'
import { installAppMenu } from './menu'
import { loadWindowState, saveWindowState } from './window-state'
import { TelegramTokenStore } from './notifications/token-store'
import { NotificationHub } from './notifications/hub'
import { RemoteAuth, generatePin, isValidStaticPin } from './remote/auth'
import { RemoteBridge } from './remote/bridge'
import type { PiStatus } from '../shared/ipc-contracts'

let mainWindow: BrowserWindow | null = null
let piHost: PiHost | null = null
let gitService: GitService | null = null
let kanbanService: KanbanService | null = null
let fileService: FileService | null = null
let terminalService: TerminalService | null = null
let bridge: RemoteBridge | null = null
let hub: NotificationHub | null = null
let loopController: LoopController | null = null
let scheduledService: ScheduleService | null = null
let windowStatePath = ''

// Смоук-режим: окно вне всех мониторов, чтобы не красть фокус. Без этих переключателей
// Chromium режет таймеры/rAF у невидимого окна и смоук начинает таймаутить.
const SMOKE_SWITCHES = ['disable-renderer-backgrounding', 'disable-backgrounding-occluded-windows', 'disable-background-timer-throttling']
const smokeMode = process.argv.includes('--smoke') || process.env['PIWRIGHT_SMOKE'] === '1'
if (smokeMode) {
  for (const name of SMOKE_SWITCHES) app.commandLine.appendSwitch(name)
}

/** Позиция за пределами объединения всех мониторов. */
function offscreenPosition(): { x: number; y: number } {
  const displays = screen.getAllDisplays()
  const span = Math.max(...displays.map((d) => Math.max(d.bounds.width, d.bounds.height)))
  return {
    x: Math.min(...displays.map((d) => d.bounds.x)) - span * 2,
    y: Math.min(...displays.map((d) => d.bounds.y)) - span * 2
  }
}

function createWindow(bg: string): void {
  const state = loadWindowState(windowStatePath, screen.getPrimaryDisplay().workArea)
  const offscreen = smokeMode ? offscreenPosition() : undefined
  mainWindow = new BrowserWindow({
    x: offscreen?.x,
    y: offscreen?.y,
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
      sandbox: true,
      ...(smokeMode ? { backgroundThrottling: false } : {})
    }
  })
  mainWindow.once('ready-to-show', () => {
    if (smokeMode) mainWindow?.showInactive()
    else mainWindow?.show()
  })
  if (!smokeMode && state.maximized) mainWindow.maximize()
  mainWindow.on('close', () => {
    if (smokeMode) return
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
  const kanbanThemes = new KanbanThemeService(join(app.getPath('userData'), 'kanban-themes.json'))
  gitService = new GitService(() => settings.get())
  kanbanService = new KanbanService(() => settings.get())
  fileService = new FileService({
    onChanged: (project, path) => mainWindow?.webContents.send(FILES_CHANGED_CHANNEL, { project, path })
  })
  const tokenStore = new TelegramTokenStore(
    app.getPath('userData'),
    (value) => safeStorage.encryptString(value),
    (buffer) => safeStorage.decryptString(buffer)
  )
  const sendStatus = (status: PiStatus): void => {
    scheduledService?.onStatus(status)
    mainWindow?.webContents.send(PI_STATUS_CHANNEL, {
      ...status,
      telegram: bridge?.telegramEnabledFor(status.hostId) ?? false,
      shared: bridge?.sharedFor(status.hostId) ?? false
    })
  }
  piHost = new PiHost(
    () => settings.get(),
    {
      onStatus: sendStatus,
      onEvent: (message) => {
        loopController?.onEvent(message)
        scheduledService?.onEvent(message)
        mainWindow?.webContents.send(PI_EVENT_CHANNEL, message)
        hub?.onEvent(message)
      }
    }
  )
  const git = gitService
  loopController = new LoopController(piHost, (hostId, event) => {
    mainWindow?.webContents.send(PI_EVENT_CHANNEL, { hostId, event })
    if (event.type === 'loop_state') {
      bridge?.loopState(hostId, event.info)
      if (!event.info.active && event.info.reason !== null) hub?.onLoopStopped(hostId, event.info.reason)
    }
  }, (previousHostId, createdHostId) => {
    const previous = piHost?.get(previousHostId) ?? null
    if (previous === null) return
    if (previous.telegramEnabled) bridge?.setTelegramEnabledByHost(createdHostId, true)
    if (bridge?.sharedFor(previousHostId) ?? false) bridge?.setSharedByHost(createdHostId, true)
    const createdStatus = piHost?.get(createdHostId)?.lastStatus()
    if (createdStatus !== null && createdStatus !== undefined) sendStatus(createdStatus)
  }, undefined, undefined, (project) => git.worktreeMergeBase(project))
  scheduledService = new ScheduleService(
    join(app.getPath('userData'), 'scheduled-prompts.json'),
    piHost,
    loopController,
    () => settings.get(),
    () => {
      mainWindow?.webContents.send(SCHEDULED_CHANGED_CHANNEL)
    }
  )
  const staticPin = settings.get().notifications.remote.staticPin
  const auth = new RemoteAuth(isValidStaticPin(staticPin) ? staticPin : generatePin())
  bridge = new RemoteBridge(() => settings.get(), piHost, auth, null, loopController)
  bridge.applySettings(settings.get())
  hub = new NotificationHub(() => settings.get(), tokenStore, piHost, () => bridge)
  terminalService = new TerminalService({
    onData: (id, data) => mainWindow?.webContents.send(TERM_DATA_CHANNEL, { id, data }),
    onExit: (id, code) => mainWindow?.webContents.send(TERM_EXIT_CHANNEL, { id, code })
  })
  const rebuildMenu = installAppMenu(() => settings.get().language, () => mainWindow)
  registerIpc(ipcMain, settings, piHost, gitService, fileService, terminalService, loopController, kanbanService, kanbanThemes, {
    tokenStore,
    bridge,
    onSettingsChanged: (next) => {
      bridge?.applySettings(next)
      rebuildMenu()
    }
  }, scheduledService)
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
  scheduledService?.dispose()
  fileService?.dispose()
  terminalService?.disposeAll()
})
