import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, screen, shell } from 'electron'
import { APP_UPDATE_EVENT_CHANNEL } from '../shared/ipc-contracts'
import { createAppContext, type AppContext } from './bootstrap'
import { attachIpcServer } from './ipc/ipc-server'
import type { IpcHost } from './ipc/register'
import { startAutoUpdater } from './updater'
import { consumeUpdateInfo } from './update-state'
import { installAppMenu } from './menu'
import { loadWindowState, saveWindowState } from './window-state'
import { appendCrashLog, crashDialogPlan, isRecoverableCrash, readSandboxOverride, writeSandboxOverride } from './crash-recovery'

let mainWindow: BrowserWindow | null = null
let context: AppContext | null = null
let rebuildMenu: (() => void) | null = null

// Смоук-режим: окно вне всех мониторов, чтобы не красть фокус. Без этих переключателей
// Chromium режет таймеры/rAF у невидимого окна и смоук начинает таймаутить.
const SMOKE_SWITCHES = ['disable-renderer-backgrounding', 'disable-backgrounding-occluded-windows', 'disable-background-timer-throttling']
const smokeMode = process.argv.includes('--smoke') || process.env['PIWRIGHT_SMOKE'] === '1'
if (smokeMode) {
  for (const name of SMOKE_SWITCHES) app.commandLine.appendSwitch(name)
}

// Chromium draws native menu accelerator names (e.g. comma) from its own locale pak,
// which follows the OS language — not the app language setting. Force --lang from
// settings.json before ready so English UI shows "Ctrl+," instead of "Ctrl+Запятая".
// Chromium reads this switch once at startup: changing the language takes effect after restart.
try {
  const raw: unknown = JSON.parse(readFileSync(join(app.getPath('userData'), 'settings.json'), 'utf8'))
  const lang = raw !== null && typeof raw === 'object' && (raw as Record<string, unknown>)['language'] === 'ru' ? 'ru-RU' : 'en-US'
  app.commandLine.appendSwitch('lang', lang)
} catch {
  app.commandLine.appendSwitch('lang', 'en-US')
}

// The renderer previously crashed in the Chromium sandbox on this machine and the user
// chose the no-sandbox fallback. Chromium reads this switch once at startup.
if (readSandboxOverride(app.getPath('userData')) !== null) app.commandLine.appendSwitch('no-sandbox')

/** Позиция за пределами объединения всех мониторов. */
function offscreenPosition(): { x: number; y: number } {
  const displays = screen.getAllDisplays()
  const span = Math.max(...displays.map((d) => Math.max(d.bounds.width, d.bounds.height)))
  return {
    x: Math.min(...displays.map((d) => d.bounds.x)) - span * 2,
    y: Math.min(...displays.map((d) => d.bounds.y)) - span * 2
  }
}

function createWindow(bg: string, lang: () => 'en' | 'ru'): void {
  const state = loadWindowState(join(app.getPath('userData'), 'window-state.json'), screen.getPrimaryDisplay().workArea)
  const offscreen = smokeMode ? offscreenPosition() : undefined
  mainWindow = new BrowserWindow({
    x: offscreen?.x,
    y: offscreen?.y,
    width: state.width,
    height: state.height,
    title: 'PiWright',
    backgroundColor: bg,
    icon: app.isPackaged
      ? join(process.resourcesPath, process.platform === 'win32' ? 'icon.ico' : 'icon.png')
      : join(__dirname, '../../build', process.platform === 'win32' ? 'icon.ico' : 'icon.png'),
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      ...(smokeMode ? { backgroundThrottling: false } : {})
    }
  })
  const showCrashDialog = (reason: string, exitCode: number): void => {
    const userDataDir = app.getPath('userData')
    const sandboxDisabled = readSandboxOverride(userDataDir) !== null
    appendCrashLog(userDataDir, `[${new Date().toISOString()}] v${app.getVersion()} ${reason} exitCode=${exitCode} noSandbox=${sandboxDisabled}`)
    if (smokeMode) return
    const win = mainWindow
    if (win === null || win.isDestroyed()) return
    if (!win.isVisible()) win.show()
    const plan = crashDialogPlan(lang(), sandboxDisabled, reason, exitCode)
    const pick = dialog.showMessageBoxSync(win, {
      type: 'error',
      title: plan.title,
      message: plan.message,
      detail: plan.detail,
      buttons: plan.buttons,
      noLink: true,
      cancelId: plan.buttons.length - 1
    })
    if (pick === 0) {
      win.webContents.reload()
    } else if (pick === plan.restartNoSandboxIndex) {
      writeSandboxOverride(userDataDir, `${reason} (exitCode ${exitCode})`)
      // Plain app.relaunch() drops CLI args (user-data-dir, debugging port) — pass them through.
      app.relaunch({ args: process.argv.slice(1) })
      app.quit()
    } else {
      win.close()
    }
  }
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    if (isRecoverableCrash(details.reason)) showCrashDialog(details.reason, details.exitCode)
  })
  // Missing renderer files after a botched update: same recovery dialog. In dev the
  // vite dev server hiccups produce transient failures — no dialog there.
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, _description, _url, isMainFrame) => {
    if (isMainFrame && errorCode !== -3 && !process.env['ELECTRON_RENDERER_URL']) showCrashDialog('launch-failed', errorCode)
  })
  mainWindow.once('ready-to-show', () => {
    if (smokeMode) mainWindow?.showInactive()
    else mainWindow?.show()
  })
  if (!smokeMode && state.maximized) mainWindow.maximize()
  mainWindow.on('close', () => {
    if (smokeMode) return
    saveWindowState(join(app.getPath('userData'), 'window-state.json'), mainWindow as BrowserWindow)
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

app.whenReady().then(async () => {
  // Сборка сервисов и каналов — общая с headless-сервером (bootstrap.ts); Electron-специфика
  // здесь: окно, меню, IPC-провод, автоапдейтер.
  context = await createAppContext({
    userDataPath: app.getPath('userData'),
    appVersion: app.getVersion(),
    updateInfo: await consumeUpdateInfo(app.getPath('userData'), app.getVersion()),
    ipc: {
      appVersion: app.getVersion(),
      userDataPath: app.getPath('userData'),
      showItemInFolder: (path) => {
        shell.showItemInFolder(path)
      },
      openExternal: (url) => shell.openExternal(url),
      chooseDirectory: async (defaultPath) => {
        const result = await dialog.showOpenDialog({
          properties: ['openDirectory', 'createDirectory'],
          defaultPath
        })
        return { canceled: result.canceled, paths: result.filePaths }
      }
    } satisfies IpcHost,
    onSettingsChanged: () => {
      rebuildMenu?.()
    }
  })
  // Пуш-события в окно: sink замыкается на переменную — окно может появиться позже контекста.
  context.events.addSink((channel, ...values) => mainWindow?.webContents.send(channel, ...values))
  rebuildMenu = installAppMenu(() => context?.settings.get().language ?? 'en', context.events)
  attachIpcServer(ipcMain, context.router)
  startAutoUpdater(() => context?.settings.get().updateUrl ?? '', context.settings, (status) => {
    context?.events.emit(APP_UPDATE_EVENT_CHANNEL, status)
  })
  const bg = context.settings.get().theme === 'light' ? '#f5f6f8' : '#14161a'
  createWindow(bg, () => context?.settings.get().language ?? 'en')
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(bg, () => context?.settings.get().language ?? 'en')
  })
})

app.on('window-all-closed', () => {
  app.quit()
})

let quitDisposalStarted = false
app.on('will-quit', (event) => {
  if (!quitDisposalStarted) {
    quitDisposalStarted = true
    event.preventDefault()
    void context?.dispose().then(() => app.quit())
    return
  }
})
