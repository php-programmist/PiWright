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
    private readonly installAskExtension?: (project: ProjectEntry, settings: Settings) => Promise<string | null>
  ) {}

  create(project: ProjectEntry, sessionFile?: string | null): SessionHost {
    const seed = this.catalogs.get(project.kind)
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
      installAskExtension: this.installAskExtension,
      seedModels: seed?.models,
      seedThinkingLevels: seed?.thinkingLevels
    })
    this.hosts.set(host.id, host)
    return host
  }

  /** Есть ли кэш каталога для бэкенда — без него новую сессию поднимаем сразу (см. sessions:new). */
  hasCatalog(kind: BackendMode): boolean {
    return this.catalogs.has(kind)
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

  disposeAll(): void {
    for (const host of this.hosts.values()) host.dispose()
    this.hosts.clear()
  }
}
