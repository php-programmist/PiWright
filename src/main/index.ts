import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, safeStorage, screen } from 'electron'
import {
  APP_UPDATE_EVENT_CHANNEL,
  DAEMON_RESOLVE_SKEW_CHANNEL,
  DAEMON_SKEW_CHANNEL,
  DAEMON_STATUS_CHANNEL,
  DAEMON_STOP_BACKGROUND_CHANNEL,
  FILES_CHANGED_CHANNEL,
  PI_EVENT_CHANNEL,
  PI_STATUS_CHANNEL,
  SCHEDULED_CHANGED_CHANNEL,
  TERM_DATA_CHANNEL,
  TERM_EXIT_CHANNEL
} from '../shared/ipc-contracts'
import { registerIpc } from './ipc/register'
import { GitService } from './git/git-service'
import { CodeCheckpoints } from './git/code-checkpoints'
import { FileService } from './files/file-service'
import { KanbanService } from './kanban/kanban-service'
import { KanbanThemeService } from './kanban/kanban-theme-service'
import { TerminalService, createSshPty } from './terminal/terminal-service'
import { getSshService, initSshService } from './ssh/ssh-service'
import { startAutoUpdater } from './updater'
import { consumeUpdateInfo } from './update-state'
import { PiHost } from './pi/pi-host'
import { LoopController } from './pi/loop-controller'
import { ScheduleService } from './schedule/schedule-service'
import { TokenStatsService } from './stats/stats-service'
import { SettingsService } from './settings/settings'
import { installAppMenu } from './menu'
import { loadWindowState, saveWindowState } from './window-state'
import { appendCrashLog, crashDialogPlan, isRecoverableCrash, readSandboxOverride, writeSandboxOverride } from './crash-recovery'
import { TelegramTokenStore } from './notifications/token-store'
import { NotificationHub } from './notifications/hub'
import { RemoteAuth, generatePin, isValidStaticPin } from './remote/auth'
import { RemoteBridge } from './remote/bridge'
import { initDaemonClient, getDaemonClient } from './daemon/client'
import type { DaemonSkewInfo, DaemonStatus, DaemonStopResult, PiStatus } from '../shared/ipc-contracts'

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
let statsService: TokenStatsService | null = null
let windowStatePath = ''
/** Нерешённое расхождение версии протокола демона (диалог в renderer). */
let daemonSkew: DaemonSkewInfo | null = null

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

app.whenReady().then(async () => {
  windowStatePath = join(app.getPath('userData'), 'window-state.json')
  const settings = new SettingsService(join(app.getPath('userData'), 'settings.json'))
  initSshService(
    app.getPath('userData'),
    (value) => safeStorage.encryptString(value),
    (buffer) => safeStorage.decryptString(buffer)
  )
  const kanbanThemes = new KanbanThemeService(join(app.getPath('userData'), 'kanban-themes.json'))
  gitService = new GitService(() => settings.get())
  kanbanService = new KanbanService(() => settings.get())
  fileService = new FileService({
    onChanged: (project, path) => mainWindow?.webContents.send(FILES_CHANGED_CHANNEL, { project, path })
  }, () => settings.get())
  const tokenStore = new TelegramTokenStore(
    app.getPath('userData'),
    (value) => safeStorage.encryptString(value),
    (buffer) => safeStorage.decryptString(buffer)
  )
  // Демон фоновых сессий: токен бота — для фоновых telegram-уведомлений (safeStorage — только main);
  // version-skew — диалог «остановить или продолжить» в renderer.
  initDaemonClient({
    userDataDir: app.getPath('userData'),
    appVersion: app.getVersion(),
    getTelegramToken: () => tokenStore.read(),
    onVersionSkew: (info) => {
      daemonSkew = info
      mainWindow?.webContents.send(DAEMON_SKEW_CHANNEL, info)
    }
  })
  const sendStatus = (status: PiStatus): void => {
    loopController?.onStatus(status)
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
    },
    undefined,
    undefined,
    new CodeCheckpoints(gitService, join(app.getPath('userData'), 'checkpoints')),
    // Персист открытых вкладок сессий — восстановление после рестарта (эффект Herdr).
    (tabs) => {
      settings.set({ openSessionTabs: tabs })
    },
    // Тогглы сессии (telegram/shared) восстанавливаются по файлу при открытии существующей сессии;
    // там же возвращается петля, отвязанная вместе с вкладкой (или пережавшая рестарт в настройках).
    (host, sessionFile) => {
      if (settings.get().loopsEnabled) loopController?.reattach(sessionFile, host.id)
      const toggles = settings.get().sessionToggles[sessionFile]
      if (toggles === undefined) return
      if (toggles.telegram && !host.telegramEnabled) {
        host.telegramEnabled = true
        bridge?.setTelegramEnabledByHost(host.id, true)
      }
      if (toggles.shared && !(bridge?.sharedFor(host.id) ?? false)) bridge?.setSharedByHost(host.id, true)
    },
    // Файл сессии итерации петли стал известен (хендшейк/форк) — обновить ключ персиста петли.
    (host, sessionFile) => {
      loopController?.noteSessionFile(host.id, sessionFile)
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
  }, undefined, undefined, (project) => git.worktreeMergeBase(project), (loops) => {
    settings.set({ loops })
  }, () => settings.get().loops)
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
  bridge = new RemoteBridge(() => settings.get(), piHost, auth, null, loopController, kanbanService)
  bridge.applySettings(settings.get())
  hub = new NotificationHub(() => settings.get(), tokenStore, piHost, () => bridge)
  statsService = new TokenStatsService(join(app.getPath('userData'), 'token-stats.json'), () => settings.get())
  void statsService.ensureScanned().catch(() => {})
  terminalService = new TerminalService({
    onData: (id, data) => mainWindow?.webContents.send(TERM_DATA_CHANNEL, { id, data }),
    onExit: (id, code) => mainWindow?.webContents.send(TERM_EXIT_CHANNEL, { id, code })
  }, undefined, (server, cwd) => createSshPty(getSshService(), server, cwd))
  const rebuildMenu = installAppMenu(() => settings.get().language, () => mainWindow)
  registerIpc(ipcMain, settings, piHost, gitService, fileService, terminalService, loopController, kanbanService, kanbanThemes, {
    tokenStore,
    bridge,
    onSettingsChanged: (next) => {
      bridge?.applySettings(next)
      rebuildMenu()
    }
  }, scheduledService, statsService, await consumeUpdateInfo(app.getPath('userData'), app.getVersion()))
  startAutoUpdater(() => settings.get().updateUrl, settings, (status) => {
    mainWindow?.webContents.send(APP_UPDATE_EVENT_CHANNEL, status)
  })
  // Каналы демона: статус (индикатор «N в фоне»), остановка фоновых, решение version-skew.
  // Не в register.ts: нужны skew-состояние и mainWindow этого модуля.
  ipcMain.handle(DAEMON_STATUS_CHANNEL, async (): Promise<DaemonStatus> => {
    const client = getDaemonClient()
    if (client === null || !client.connectedNow) return { alive: false, background: 0, skew: daemonSkew }
    try {
      const sessions = await client.list()
      return { alive: true, background: sessions.filter((s) => s.clients === 0).length, skew: daemonSkew }
    } catch {
      return { alive: false, background: 0, skew: daemonSkew }
    }
  })
  ipcMain.handle(DAEMON_STOP_BACKGROUND_CHANNEL, async (): Promise<DaemonStopResult> => {
    const client = getDaemonClient()
    if (client === null || !client.connectedNow) return { ok: false, stopped: 0, error: 'Daemon is not running' }
    try {
      return { ok: true, stopped: await client.killBackground(), error: null }
    } catch (err) {
      return { ok: false, stopped: 0, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle(DAEMON_RESOLVE_SKEW_CHANNEL, (_event, stop: unknown) => {
    const client = getDaemonClient()
    if (client === null) return { ok: false }
    if (stop === true) {
      // Старый демон гасится (дети прерваны) — следующий спавн поднимет свежий.
      void client.shutdownDaemon().then((ok) => {
        if (!ok) return
        daemonSkew = null
        client.clearDisabled()
        piHost?.ensureAllStarted()
      }).catch(() => {})
    } else {
      // Продолжаем со старым демоном: пересылка стабильна, новые фичи демона — после следующего обновления.
      daemonSkew = null
      client.clearDisabled()
      piHost?.ensureAllStarted()
    }
    return { ok: true }
  })
  // Раннее подключение к демону: обнаружение version-skew до восстановления вкладок
  // (спавнеры при skew не делают локальный фолбэк — иначе дубли процессов на файл сессии).
  void getDaemonClient()?.connect().catch(() => {})
  // Восстановление открытых вкладок сессий: хосты создаются сразу (видны в панели), подъём —
  // на первом sessions:list из рендерера, чтобы реплей транскрипта не ушёл в пустоту.
  for (const tab of settings.get().openSessionTabs) {
    piHost.create(tab.project, tab.sessionFile)
  }
  const bg = settings.get().theme === 'light' ? '#f5f6f8' : '#14161a'
  createWindow(bg, () => settings.get().language)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(bg, () => settings.get().language)
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
    // Ход идёт — сессия отвязывается и дозает ход в фоне (вотчер демона закроет её через грейс
    // без нового хода); ход не идёт — процесс останавливается сразу (память дороже транскрипта).
    // Вкладки восстановления сохраняются: при старте откроются снова — живые аттачатся,
    // остановленные восстановятся из транскрипта. Явная остановка — «Остановить сессию» в UI
    // и «Остановить все фоновые сессии» (piHost.disposeAll, задача 3).
    piHost?.quiesceForQuit()
    scheduledService?.dispose()
    fileService?.dispose()
    terminalService?.disposeAll()
    try {
      getSshService().closeAll()
    } catch {
      // ssh-сервис мог не инициализироваться (ранний выход)
    }
    const finish = (): void => {
      void app.quit()
    }
    // Ждём закрытия сокета: записи (rekey и т.п.) асинхронны и без флеша теряются при выходе.
    const client = getDaemonClient()
    if (client === null) finish()
    else void client.dispose().then(finish)
    setTimeout(finish, 3000)
    return
  }
})
