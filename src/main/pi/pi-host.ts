/** Реестр сессий приложения: одна сессия = один `SessionHost` со своим процессом pi.
 *  По плану §2 — `PiHost`. Renderer'у уходят статусы и события, помеченные hostId. */
import type { ExtensionDialog } from '../../shared/agent-events'
import type { HostRef, PiEventMessage, PiStatus, ProjectEntry, Settings } from '../../shared/ipc-contracts'
import { SessionHost } from './session-host'
import type { SessionHostListener } from './session-host'
import type { CreateBackendResult } from './backends/factory'

export interface PiHostSink {
  onStatus(status: PiStatus): void
  onEvent(message: PiEventMessage): void
}

export class PiHost {
  private readonly hosts = new Map<string, SessionHost>()

  constructor(
    private readonly getSettings: () => Settings,
    private readonly sink: PiHostSink,
    private readonly createBackend?: (project: ProjectEntry, settings: Settings) => Promise<CreateBackendResult>,
    private readonly installAskExtension?: (project: ProjectEntry, settings: Settings) => Promise<string | null>
  ) {}

  create(project: ProjectEntry, sessionFile?: string | null): SessionHost {
    const listener: SessionHostListener = {
      onStatus: (status) => this.sink.onStatus(status),
      onEvent: (event) => this.sink.onEvent({ hostId: host.id, event })
    }
    const host = new SessionHost(this.getSettings, listener, project, {
      sessionFile,
      createBackend: this.createBackend,
      installAskExtension: this.installAskExtension
    })
    this.hosts.set(host.id, host)
    return host
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
