import { join } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { PI_EVENT_CHANNEL, PI_STATUS_CHANNEL } from '../shared/ipc-contracts'
import { registerIpc } from './ipc/register'
import { GitService } from './git/git-service'
import { PiHost } from './pi/pi-host'
import { SettingsService } from './settings/settings'

let mainWindow: BrowserWindow | null = null
let piHost: PiHost | null = null
let gitService: GitService | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    title: 'Piwright',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
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
  const settings = new SettingsService(join(app.getPath('userData'), 'settings.json'))
  gitService = new GitService(() => settings.get())
  piHost = new PiHost(
    () => settings.get(),
    {
      onStatus: (status) => mainWindow?.webContents.send(PI_STATUS_CHANNEL, status),
      onEvent: (message) => mainWindow?.webContents.send(PI_EVENT_CHANNEL, message)
    }
  )
  registerIpc(ipcMain, settings, piHost, gitService)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('will-quit', () => {
  piHost?.disposeAll()
})
