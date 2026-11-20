/** TerminalService: node-pty сессии в main. Терминалы привязаны к проекту (не к сессии),
 *  живут до закрытия вкладки или выхода приложения. Байты — строками (node-pty сам
 *  декодирует UTF-8), события наружу — через TerminalEvents. */
import { randomUUID } from 'node:crypto'
import { spawn as ptySpawn } from 'node-pty'
import type { IPty } from 'node-pty'
import type { ProjectEntry } from '../../shared/ipc-contracts'
import type { TerminalInfo, TerminalProfile, TerminalProfileId } from '../../shared/ipc-contracts'
import { availableProfiles, defaultProfileId, resolveSpawn } from './profiles'
import type { ProfileAvailability } from './profiles'

export interface TerminalEvents {
  onData: (id: string, data: string) => void
  onExit: (id: string, code: number) => void
}

export type PtySpawner = (file: string, args: string[], cwd: string) => IPty

export interface TerminalProfilesResult {
  profiles: TerminalProfile[]
  defaultProfileId: TerminalProfileId
}

function defaultSpawner(file: string, args: string[], cwd: string): IPty {
  return ptySpawn(file, args, { name: 'xterm-256color', cwd })
}

export class TerminalService {
  private readonly terms = new Map<string, { pty: IPty; info: TerminalInfo }>()

  constructor(
    private readonly events: TerminalEvents,
    private readonly spawnPty: PtySpawner = defaultSpawner
  ) {}

  profiles(project: ProjectEntry, avail: ProfileAvailability): TerminalProfilesResult {
    return { profiles: availableProfiles(avail), defaultProfileId: defaultProfileId(project.kind, avail) }
  }

  async create(project: ProjectEntry, profileId: TerminalProfileId | null, avail: ProfileAvailability): Promise<TerminalInfo | null> {
    const id = profileId ?? defaultProfileId(project.kind, avail)
    const resolved = await resolveSpawn(project, id, avail)
    if (resolved === null) return null
    const label = availableProfiles(avail).find((p) => p.id === id)?.label ?? id
    const info: TerminalInfo = { id: randomUUID(), profileId: id, label }
    const pty = this.spawnPty(resolved.file, resolved.args, resolved.cwd)
    pty.onData((data) => this.events.onData(info.id, data))
    pty.onExit(({ exitCode }) => {
      this.terms.delete(info.id)
      this.events.onExit(info.id, exitCode)
    })
    this.terms.set(info.id, { pty, info })
    return info
  }

  input(id: string, data: string): void {
    this.terms.get(id)?.pty.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    this.terms.get(id)?.pty.resize(Math.floor(cols), Math.floor(rows))
  }

  close(id: string): void {
    const term = this.terms.get(id)
    if (term === undefined) return
    this.terms.delete(id)
    term.pty.kill()
  }

  disposeAll(): void {
    for (const { pty } of this.terms.values()) pty.kill()
    this.terms.clear()
  }
}
