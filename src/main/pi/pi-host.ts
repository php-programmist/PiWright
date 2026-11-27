/** Реестр сессий приложения: одна сессия = один `SessionHost` со своим процессом pi.
 *  По плану §2 — `PiHost`. Renderer'у уходят статусы и события, помеченные hostId. */
import type { ExtensionDialog } from '../../shared/agent-events'
import type { BackendMode, HostRef, PiEventMessage, PiStatus, ProjectEntry, SavedSessionTab, Settings } from '../../shared/ipc-contracts'
import type { PiModelInfo } from '../../shared/protocol-types'
import { SessionHost } from './session-host'
import type { SessionHostListener } from './session-host'
import type { CreateBackendResult } from './backends/factory'
import type { CodeCheckpoints } from '../git/code-checkpoints'

export interface PiHostSink {
  onStatus(status: PiStatus): void
  onEvent(message: PiEventMessage): void
}

export class PiHost {
  private readonly hosts = new Map<string, SessionHost>()
  /** Каталог моделей/уровней thinking по типу бэкенда — из последних хендшейков; сид для новых сессий. */
  private readonly catalogs = new Map<BackendMode, { models: PiModelInfo[]; thinkingLevels: string[] }>()
  /** Открытые вкладки сессий (hostId → вкладка) — пишутся в настройки при открытии/закрытии/rekey. */
  private readonly openTabs = new Map<string, SavedSessionTab>()
  /** Отвязанные сессии (крестик во время хода): sessionKey демона → hostId. Ход допишется —
   *  вотчер демона закроет ребёнка, вкладка восстановления забудется. */
  private readonly detachedTabs = new Map<string, string>()

  constructor(
    private readonly getSettings: () => Settings,
    private readonly sink: PiHostSink,
    private readonly createBackend?: (project: ProjectEntry, settings: Settings) => Promise<CreateBackendResult>,
    private readonly installExtensions?: (project: ProjectEntry, settings: Settings) => Promise<(string | null)[]>,
    private readonly checkpoints?: CodeCheckpoints | null,
    /** Персист открытых вкладок сессий (settings.openSessionTabs) — восстановление после рестарта. */
    private readonly persistOpenTabs?: (tabs: SavedSessionTab[]) => void,
    /** Восстановление тогглов сессии (telegram/shared) по файлу — при открытии существующей сессии. */
    private readonly restoreToggles?: (host: SessionHost, sessionFile: string) => void,
    /** Файл сессии стал известен/изменился (хендшейк новой сессии, fork) — подписка вне реестра вкладок. */
    private readonly onSessionFileKnown?: (host: SessionHost, sessionFile: string) => void,
    /** Персист запомненных уровней thinking по моделям (settings.thinkingLevelByModel). */
    private readonly persistThinkingLevels?: (byModel: Record<string, string>) => void
  ) {}

  /** Переопределение последнего выбора пользователя — петля копирует модель/уровень родителя. */
  create(project: ProjectEntry, sessionFile?: string | null, overrides?: { model?: string | null; thinkingLevel?: string | null }): SessionHost {
    const seed = this.catalogs.get(project.kind)
    const settings = this.getSettings()
    const listener: SessionHostListener = {
      onStatus: (status) => {
        if (status.models.length > 0) this.catalogs.set(project.kind, { models: status.models, thinkingLevels: status.thinkingLevels })
        this.sink.onStatus(status)
      },
      onEvent: (event) => this.sink.onEvent({ hostId: host.id, event })
    }
    const host = new SessionHost(this.getSettings, listener, project, {
      sessionFile,
      createBackend: this.createBackend,
      installExtensions: this.installExtensions,
      checkpoints: this.checkpoints ?? null,
      seedModels: seed?.models,
      seedThinkingLevels: seed?.thinkingLevels,
      // Возобновлённая сессия несёт свою модель/уровень в файле сессии — последний выбор только для новых.
      initialModel: sessionFile == null ? overrides?.model ?? settings.lastModel : null,
      // Уровень — из явного override, затем из запомненного за этой моделью, затем глобальный последний.
      initialThinkingLevel:
        sessionFile == null
          ? overrides?.thinkingLevel ??
            settings.thinkingLevelByModel[overrides?.model ?? settings.lastModel ?? ''] ??
            settings.lastThinkingLevel
          : null,
      onThinkingLevelChosen: (modelKey, level) => {
        const byModel = this.getSettings().thinkingLevelByModel
        if (byModel[modelKey] === level) return
        this.persistThinkingLevels?.({ ...byModel, [modelKey]: level })
      },
      onSessionFile: (file, sessionKey) => {
        if (sessionKey !== null) this.detachedTabs.delete(sessionKey)
        this.trackOpenTab(host.id, project, file)
      }
    })
    this.hosts.set(host.id, host)
    if (sessionFile != null) {
      this.trackOpenTab(host.id, project, sessionFile)
      this.restoreToggles?.(host, sessionFile)
    }
    return host
  }

  /** Вкладка восстановления: новая/переименованная (fork меняет файл) — с записью в настройки. */
  private trackOpenTab(hostId: string, project: ProjectEntry, sessionFile: string): void {
    const existing = this.openTabs.get(hostId)
    if (existing === undefined || existing.sessionFile !== sessionFile) {
      this.openTabs.set(hostId, { project, sessionFile })
      this.persistOpenTabs?.([...this.openTabs.values()])
    }
    const host = this.hosts.get(hostId)
    if (host !== undefined) this.onSessionFileKnown?.(host, sessionFile)
  }

  private forgetOpenTab(hostId: string): void {
    if (this.openTabs.delete(hostId)) this.persistOpenTabs?.([...this.openTabs.values()])
  }

  /** Форк сессии в новую (порт openForkTab из jb-pi): новый хост стартует на файле родителя,
   *  первый запрос ветвляет его (fork на промпт/clone), родитель не трогается.
   *  Имя — «(fork) <родитель>» — в начале, чтобы не обрезалось в конце; thinking переезжает от родителя. */
  createFork(parentHostId: string, fork: { userText: string | null; occurrence: number }): SessionHost | null {
    const parent = this.hosts.get(parentHostId)
    if (parent === undefined) return null
    const sessionFile = parent.sessionFilePath
    if (sessionFile === null) return null
    const seed = this.catalogs.get(parent.project.kind)
    const listener: SessionHostListener = {
      onStatus: (status) => {
        if (status.models.length > 0) this.catalogs.set(parent.project.kind, { models: status.models, thinkingLevels: status.thinkingLevels })
        this.sink.onStatus(status)
      },
      onEvent: (event) => this.sink.onEvent({ hostId: host.id, event })
    }
    const host = new SessionHost(this.getSettings, listener, parent.project, {
      sessionFile,
      forkSpec: fork,
      createBackend: this.createBackend,
      installExtensions: this.installExtensions,
      checkpoints: this.checkpoints ?? null,
      seedModels: seed?.models,
      seedThinkingLevels: seed?.thinkingLevels,
      initialSessionName: `(fork) ${parent.displayTitle}`,
      initialThinkingLevel: parent.lastStatus()?.thinkingLevel ?? null,
      onSessionFile: (file, sessionKey) => {
        if (sessionKey !== null) this.detachedTabs.delete(sessionKey)
        this.trackOpenTab(host.id, parent.project, file)
      }
    })
    this.hosts.set(host.id, host)
    this.trackOpenTab(host.id, parent.project, sessionFile)
    return host
  }

  /** Есть ли кэш каталога для бэкенда — без него новую сессию поднимаем сразу (см. sessions:new). */
  hasCatalog(kind: BackendMode): boolean {
    return this.catalogs.has(kind)
  }

  /** Перечитать каталог моделей на всех живых сессиях — после правки models.json (фокус окна).
   *  Кэш catalogs обновляется сам через onStatus в listener'ах. */
  async refreshCatalogs(): Promise<void> {
    await Promise.all([...this.hosts.values()].map((h) => h.refreshModelCatalog()))
  }

  /** Первый непустой каталог из кэша хендшейков — remote-диалогу создания до подъёма сессий. */
  cachedCatalog(): { models: PiModelInfo[]; thinkingLevels: string[] } | null {
    for (const catalog of this.catalogs.values()) {
      if (catalog.models.length > 0) return catalog
    }
    return null
  }

  get(hostId: string): SessionHost | null {
    return this.hosts.get(hostId) ?? null
  }

  /** Статусы всех сессий — стартовая выдача панели (дальше статусы приходят пушами). */
  statuses(): PiStatus[] {
    return [...this.hosts.values()].map((h) => h.lastStatus()).filter((s) => s !== null)
  }

  pendingDialogs(): { hostId: string; id: string; dialog: ExtensionDialog }[] {
    const result: { hostId: string; id: string; dialog: ExtensionDialog }[] = []
    for (const host of this.hosts.values()) {
      for (const { id, dialog } of host.getPendingDialogs()) result.push({ hostId: host.id, id, dialog })
    }
    return result
  }

  /** keepAlive=true — «отключиться, если есть чему жить»: ход идёт (streaming) — ребёнок демона
   *  отвязывается и дозывает ход в фоне (вотчер закроет его после грейса без нового хода);
   *  ход не идёт (idle/ready/waiting/error) — процесс останавливается сразу: держать агента в
   *  памяти дороже, чем восстановить из транскрипта. keepAlive=false — остановить всегда. */
  close(hostId: string, opts?: { keepAlive?: boolean }): HostRef | null {
    const host = this.hosts.get(hostId)
    if (host === undefined) return null
    let detached = false
    if (opts?.keepAlive === true && host.inFlight) {
      const sessionKey = host.detach()
      if (sessionKey !== null) {
        this.detachedTabs.set(sessionKey, hostId)
        detached = true
      }
    }
    if (!detached) {
      host.dispose()
      this.forgetOpenTab(hostId)
    }
    this.hosts.delete(hostId)
    return { hostId }
  }

  /** То же, что close(), но ждёт выхода процесса — перед удалением worktree-каталога. */
  async closeAndWait(hostId: string): Promise<boolean> {
    const host = this.hosts.get(hostId)
    if (host === undefined) return false
    await host.disposeAndWait()
    this.hosts.delete(hostId)
    this.forgetOpenTab(hostId)
    return true
  }

  /** Сессия уходит в фон (крестик вкладки при идущем ходе, renderer оставляет строку в панели):
   *  хост живёт вместе с ребёнком демона, но вкладка восстановления забывается — после рестарта
   *  она не откроется заново (сессия доступна из истории). */
  background(hostId: string): void {
    this.forgetOpenTab(hostId)
  }

  /** Подготовка к выходу приложения: ход идёт — отвязать (дозреет в фоне, вотчер демона закроет
   *  через грейс без нового хода); ход не идёт — остановить процесс (при старте сессия
   *  восстановится из транскрипта). Вкладки восстановления сохраняются для всех — при старте
   *  откроются снова: живые аттачатся, остановленные — респавн с --session. */
  quiesceForQuit(): void {
    for (const host of this.hosts.values()) {
      if (host.inFlight && host.detach() !== null) continue
      host.dispose()
    }
    this.hosts.clear()
  }

  disposeAll(): void {
    for (const host of this.hosts.values()) host.dispose()
    this.hosts.clear()
    if (this.openTabs.size > 0) {
      this.openTabs.clear()
      this.persistOpenTabs?.([])
    }
  }

  /** Поднять все хосты (восстановленные вкладки при старте). Повторные вызовы безобидны —
   *  ensureStarted идемпотентен; вызывается при первом sessions:list, когда окно уже готово
   *  получать реплей транскрипта. */
  ensureAllStarted(): void {
    for (const host of this.hosts.values()) void host.ensureStarted().catch(() => {})
  }
}
