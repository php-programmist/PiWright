/** Сборка приложения из сервисов, транспорт-агностичная: общий код Electron-точки входа
 *  (index.ts) и headless-сервера веб-режима (headless/index.ts). Роутер + шина событий +
 *  все сервисы + регистрация каналов + каналы демона + восстановление вкладок + dispose.
 *  Хостовые различия (пути, версия, dialog/shell, меню) инъектируются через AppHost. */
import { join } from 'node:path'
import {
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
import type { DaemonSkewInfo, DaemonStatus, DaemonStopResult, PiStatus, Settings } from '../shared/ipc-contracts'
import type { RpcPlatform } from '../shared/rpc-transport'
import { registerIpc, type IpcHost } from './ipc/register'
import { RpcRouter } from './ipc/router'
import { EventBroadcaster } from './ipc/events'
import { attachRpcWs, type RpcWsAttachment } from './remote/rpc-ws'
import { GitService } from './git/git-service'
import { CodeCheckpoints } from './git/code-checkpoints'
import { FileService } from './files/file-service'
import { KanbanService } from './kanban/kanban-service'
import { KanbanThemeService } from './kanban/kanban-theme-service'
import { TerminalService, createSshPty } from './terminal/terminal-service'
import { getSshService, initSshService } from './ssh/ssh-service'
import { DbSecretsService } from './db/db-secrets'
import { DbService } from './db/db-service'
import { PiHost } from './pi/pi-host'
import { LoopController } from './pi/loop-controller'
import { ScheduleService } from './schedule/schedule-service'
import { TokenStatsService } from './stats/stats-service'
import { SettingsService } from './settings/settings'
import { TelegramTokenStore } from './notifications/token-store'
import { createSecretCodec, type SecretCodec } from './secrets/secret-codec'
import { NotificationHub } from './notifications/hub'
import { RemoteAuth, generatePin, isValidStaticPin } from './remote/auth'
import { RemoteBridge } from './remote/bridge'
import { initDaemonClient, getDaemonClient } from './daemon/client'
import type { UpdateInfo } from '../shared/ipc-contracts'
import { errorMessage } from '../shared/errors'

/** Хостовые различия между Electron-приложением и headless-сервером. */
export interface AppHost {
  userDataPath: string
  appVersion: string
  updateInfo: UpdateInfo
  /** dialog/shell-возможности (см. IpcHost). */
  ipc: IpcHost
  /** Кодек секретов; по умолчанию — safeStorage-кодек (Electron). Headless передаёт файловый (AES-256-GCM). */
  secretCodec?: SecretCodec
  /** Хост — чистый node (headless): демон форкается напрямую без ELECTRON_RUN_AS_NODE. */
  nodeHost?: boolean
  /** Дополнительная реакция на сохранение настроек (Electron — перестроение меню). */
  onSettingsChanged?(next: Settings): void
}

export interface AppContext {
  router: RpcRouter
  events: EventBroadcaster
  settings: SettingsService
  piHost: PiHost
  git: GitService
  files: FileService
  terminals: TerminalService
  loops: LoopController
  kanban: KanbanService
  bridge: RemoteBridge
  auth: RemoteAuth
  rpcWs: RpcWsAttachment
  scheduled: ScheduleService
  stats: TokenStatsService
  platform: RpcPlatform
  /** quiesceForQuit + остановка сервисов + закрытие клиента демона (с потолком 3 с). */
  dispose(): Promise<void>
}

export async function createAppContext(host: AppHost): Promise<AppContext> {
  const router = new RpcRouter()
  const events = new EventBroadcaster()
  const settings = new SettingsService(join(host.userDataPath, 'settings.json'))
  const secretCodec = host.secretCodec ?? createSecretCodec()
  initSshService(
    host.userDataPath,
    (value) => secretCodec.encrypt(value),
    (buffer) => secretCodec.decrypt(buffer)
  )
  const dbService = new DbService(
    () => settings.get(),
    new DbSecretsService(
      join(host.userDataPath, 'db-secrets.json'),
      (value) => secretCodec.encrypt(value),
      (buffer) => secretCodec.decrypt(buffer)
    ),
    getSshService()
  )
  const kanbanThemes = new KanbanThemeService(join(host.userDataPath, 'kanban-themes.json'))
  const gitService = new GitService(() => settings.get())
  const kanbanService = new KanbanService(() => settings.get())
  const fileService = new FileService({
    onChanged: (project, path) => events.emit(FILES_CHANGED_CHANNEL, { project, path })
  }, () => settings.get())
  const tokenStore = new TelegramTokenStore(
    host.userDataPath,
    (value) => secretCodec.encrypt(value),
    (buffer) => secretCodec.decrypt(buffer)
  )
  // Демон фоновых сессий: токен бота — для фоновых telegram-уведомлений; version-skew —
  // диалог «остановить или продолжить» в renderer.
  let daemonSkew: DaemonSkewInfo | null = null
  initDaemonClient({
    userDataDir: host.userDataPath,
    appVersion: host.appVersion,
    getTelegramToken: () => tokenStore.read(),
    // Настройка «Фоновые сессии» выключена — демон не подключается/не запускается, спавны локальные.
    isEnabled: () => settings.get().backgroundSessions,
    nodeHost: host.nodeHost === true,
    onVersionSkew: (info) => {
      daemonSkew = info
      events.emit(DAEMON_SKEW_CHANNEL, info)
    }
  })
  let bridge: RemoteBridge | null = null
  let hub: NotificationHub | null = null
  let loopController: LoopController | null = null
  let scheduledService: ScheduleService | null = null
  const sendStatus = (status: PiStatus): void => {
    loopController?.onStatus(status)
    scheduledService?.onStatus(status)
    events.emit(PI_STATUS_CHANNEL, {
      ...status,
      telegram: bridge?.telegramEnabledFor(status.hostId) ?? false,
      shared: bridge?.sharedFor(status.hostId) ?? false
    })
  }
  const piHost = new PiHost(
    () => settings.get(),
    {
      onStatus: sendStatus,
      onEvent: (message) => {
        loopController?.onEvent(message)
        scheduledService?.onEvent(message)
        events.emit(PI_EVENT_CHANNEL, message)
        hub?.onEvent(message)
      }
    },
    undefined,
    undefined,
    new CodeCheckpoints(gitService, join(host.userDataPath, 'checkpoints')),
    // Персист открытых вкладок сессий — восстановление после рестарта (эффект Herdr).
    (tabs) => {
      settings.set({ openSessionTabs: tabs })
    },
    // Тогглы сессии (telegram/shared) восстанавливаются по файлу при открытии существующей сессии;
    // там же возвращается петля, отвязанная вместе с вкладкой (или пережавшая рестарт в настройках).
    (created, sessionFile) => {
      if (settings.get().loopsEnabled) loopController?.reattach(sessionFile, created.id)
      const toggles = settings.get().sessionToggles[sessionFile]
      if (toggles === undefined) return
      if (toggles.telegram && !created.telegramEnabled) {
        created.telegramEnabled = true
        bridge?.setTelegramEnabledByHost(created.id, true)
      }
      if (toggles.shared && !(bridge?.sharedFor(created.id) ?? false)) bridge?.setSharedByHost(created.id, true)
    },
    // Файл сессии итерации петли стал известен (хендшейк/форк) — обновить ключ персиста петли.
    (created, sessionFile) => {
      loopController?.noteSessionFile(created.id, sessionFile)
    },
    // Персист запомненных уровней thinking по моделям — восстановление при переключении модели.
    (byModel) => {
      settings.set({ thinkingLevelByModel: byModel })
    }
  )
  loopController = new LoopController(piHost, (hostId, event) => {
    events.emit(PI_EVENT_CHANNEL, { hostId, event })
    if (event.type === 'loop_state') {
      bridge?.loopState(hostId, event.info)
      if (!event.info.active && event.info.reason !== null) hub?.onLoopStopped(hostId, event.info.reason)
    }
  }, (previousHostId, createdHostId) => {
    const previous = piHost.get(previousHostId) ?? null
    if (previous === null) return
    if (previous.telegramEnabled) bridge?.setTelegramEnabledByHost(createdHostId, true)
    if (bridge?.sharedFor(previousHostId) ?? false) bridge?.setSharedByHost(createdHostId, true)
    const createdStatus = piHost.get(createdHostId)?.lastStatus()
    if (createdStatus !== null && createdStatus !== undefined) sendStatus(createdStatus)
  }, undefined, undefined, (project) => gitService.worktreeMergeBase(project), (loops) => {
    settings.set({ loops })
  }, () => settings.get().loops)
  const scheduled = new ScheduleService(
    join(host.userDataPath, 'scheduled-prompts.json'),
    piHost,
    loopController,
    () => settings.get(),
    () => {
      events.emit(SCHEDULED_CHANGED_CHANNEL)
    }
  )
  scheduledService = scheduled
  const staticPin = settings.get().notifications.remote.staticPin
  const auth = new RemoteAuth(isValidStaticPin(staticPin) ? staticPin : generatePin())
  const rpcWs = attachRpcWs({ router, events, platform: process.platform as RpcPlatform, appVersion: host.appVersion })
  bridge = new RemoteBridge(() => settings.get(), piHost, auth, null, loopController, kanbanService, rpcWs.upgrade)
  bridge.applySettings(settings.get())
  hub = new NotificationHub(() => settings.get(), tokenStore, piHost, () => bridge)
  const statsService = new TokenStatsService(join(host.userDataPath, 'token-stats.json'), () => settings.get())
  void statsService.ensureScanned().catch(() => {})
  const terminalService = new TerminalService({
    onData: (id, data) => events.emit(TERM_DATA_CHANNEL, { id, data }),
    onExit: (id, code) => events.emit(TERM_EXIT_CHANNEL, { id, code })
  }, undefined, (server, cwd) => createSshPty(getSshService(), server, cwd))
  registerIpc(router, settings, piHost, gitService, fileService, terminalService, loopController, kanbanService, kanbanThemes, dbService, host.ipc, {
    tokenStore,
    bridge,
    onSettingsChanged: (next) => {
      bridge?.applySettings(next)
      host.onSettingsChanged?.(next)
    }
  }, scheduledService, statsService, host.updateInfo)
  // Каналы демона: статус (индикатор «N в фоне»), остановка фоновых, решение version-skew.
  router.handle(DAEMON_STATUS_CHANNEL, async (): Promise<DaemonStatus> => {
    // Настройка «Фоновые сессии» выключена — индикатор фона скрыт, даже если старый демон ещё жив.
    if (!settings.get().backgroundSessions) return { alive: false, background: 0, skew: daemonSkew, sessions: [] }
    const client = getDaemonClient()
    if (client === null || !client.connectedNow) return { alive: false, background: 0, skew: daemonSkew, sessions: [] }
    try {
      const sessions = await client.list()
      // Старый демон новые поля не присылает — защищаемся (пустой проект/без имени/не стримит).
      const background = sessions
        .filter((s) => s.clients === 0)
        .map((s) => ({
          sessionKey: s.sessionKey,
          sessionFile: s.sessionFile,
          mode: s.mode,
          projectDir: typeof s.projectDir === 'string' ? s.projectDir : '',
          title: typeof s.title === 'string' ? s.title : null,
          streaming: s.streaming === true
        }))
      return { alive: true, background: background.length, skew: daemonSkew, sessions: background }
    } catch {
      return { alive: false, background: 0, skew: daemonSkew, sessions: [] }
    }
  })
  router.handle(DAEMON_STOP_BACKGROUND_CHANNEL, async (): Promise<DaemonStopResult> => {
    if (!settings.get().backgroundSessions) return { ok: false, stopped: 0, error: 'Background sessions are disabled in settings' }
    const client = getDaemonClient()
    if (client === null || !client.connectedNow) return { ok: false, stopped: 0, error: 'Daemon is not running' }
    try {
      return { ok: true, stopped: await client.killBackground(), error: null }
    } catch (err) {
      return { ok: false, stopped: 0, error: errorMessage(err) }
    }
  })
  router.handle(DAEMON_RESOLVE_SKEW_CHANNEL, (stop: unknown) => {
    const client = getDaemonClient()
    if (client === null) return { ok: false }
    if (stop === true) {
      // Старый демон гасится (дети прерваны) — следующий спавн поднимет свежий.
      void client.shutdownDaemon().then((ok) => {
        if (!ok) return
        daemonSkew = null
        client.clearDisabled()
        piHost.ensureAllStarted()
      }).catch(() => {})
    } else {
      // Продолжаем со старым демоном: пересылка стабильна, новые фичи демона — после следующего обновления.
      daemonSkew = null
      client.clearDisabled()
      piHost.ensureAllStarted()
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
  let disposalStarted = false
  return {
    router,
    events,
    settings,
    piHost,
    git: gitService,
    files: fileService,
    terminals: terminalService,
    loops: loopController,
    kanban: kanbanService,
    bridge,
    auth,
    rpcWs,
    scheduled,
    stats: statsService,
    platform: process.platform as RpcPlatform,
    async dispose(): Promise<void> {
      if (disposalStarted) return
      disposalStarted = true
      // Ход идёт — сессия отвязывается и дозает ход в фоне (вотчер демона закроет её через грейс
      // без нового хода); ход не идёт — процесс останавливается сразу (память дороже транскрипта).
      // Вкладки восстановления сохраняются: при старте откроются снова — живые аттачатся,
      // остановленные восстановятся из транскрипта. Явная остановка — «Остановить сессию» в UI
      // и «Остановить все фоновые сессии» (piHost.disposeAll, задача 3).
      piHost.quiesceForQuit()
      scheduled.dispose()
      fileService.dispose()
      terminalService.disposeAll()
      try {
        getSshService().closeAll()
      } catch {
        // ssh-сервис мог не инициализироваться (ранний выход)
      }
      try {
        await dbService.disposeAll()
      } catch {
        // db-сервис мог не инициализироваться (ранний выход)
      }
      // Ждём закрытия сокета: записи (rekey и т.п.) асинхронны и без флеша теряются при выходе.
      const client = getDaemonClient()
      if (client === null) return
      await Promise.race([
        client.dispose().then(() => {}),
        new Promise<void>((resolve) => setTimeout(resolve, 3000))
      ])
    }
  }
}
