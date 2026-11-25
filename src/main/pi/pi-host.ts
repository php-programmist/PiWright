/** Реестр сессий приложения: одна сессия = один `SessionHost` со своим процессом pi.
 *  По плану §2 — `PiHost`. Renderer'у уходят статусы и события, помеченные hostId. */
import type { ExtensionDialog } from '../../shared/agent-events'
import type { BackendMode, HostRef, PiEventMessage, PiStatus, ProjectEntry, Settings } from '../../shared/ipc-contracts'
import type { PiModelInfo } from '../../shared/protocol-types'
import { SessionHost } from './session-host'
import type { SessionHostListener } from './session-host'
import type { CreateBackendResult } from './backends/factory'

export interface PiHostSink {
  onStatus(status: PiStatus): void
  onEvent(message: PiEventMessage): void
}

export class PiHost {
  private readonly hosts = new Map<string, SessionHost>()
  /** Каталог моделей/уровней thinking по типу бэкенда — из последних хендшейков; сид для новых сессий. */
  private readonly catalogs = new Map<BackendMode, { models: PiModelInfo[]; thinkingLevels: string[] }>()

  constructor(
    private readonly getSettings: () => Settings,
    private readonly sink: PiHostSink,
    private readonly createBackend?: (project: ProjectEntry, settings: Settings) => Promise<CreateBackendResult>,
    private readonly installExtensions?: (project: ProjectEntry, settings: Settings) => Promise<(string | null)[]>
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
      seedModels: seed?.models,
      seedThinkingLevels: seed?.thinkingLevels,
      // Возобновлённая сессия несёт свою модель/уровень в файле сессии — последний выбор только для новых.
      initialModel: sessionFile == null ? overrides?.model ?? settings.lastModel : null,
      initialThinkingLevel: sessionFile == null ? overrides?.thinkingLevel ?? settings.lastThinkingLevel : null
    })
    this.hosts.set(host.id, host)
    return host
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
      seedModels: seed?.models,
      seedThinkingLevels: seed?.thinkingLevels,
      initialSessionName: `(fork) ${parent.displayTitle}`,
      initialThinkingLevel: parent.lastStatus()?.thinkingLevel ?? null
    })
    this.hosts.set(host.id, host)
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

  close(hostId: string): HostRef | null {
    const host = this.hosts.get(hostId)
    if (host === undefined) return null
    host.dispose()
    this.hosts.delete(hostId)
    return { hostId }
  }

  /** То же, что close(), но ждёт выхода процесса — перед удалением worktree-каталога. */
  async closeAndWait(hostId: string): Promise<boolean> {
    const host = this.hosts.get(hostId)
    if (host === undefined) return false
    await host.disposeAndWait()
    this.hosts.delete(hostId)
    return true
  }

  disposeAll(): void {
    for (const host of this.hosts.values()) host.dispose()
    this.hosts.clear()
  }
}
