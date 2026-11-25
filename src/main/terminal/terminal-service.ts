/** TerminalService: pty-сессии в main (node-pty для локальных профилей, shell-канал SshService
 *  для ssh). Терминалы привязаны к проекту (не к сессии), живут до закрытия вкладки или выхода
 *  приложения. Байты — строками (node-pty сам декодирует UTF-8), события наружу — через TerminalEvents. */
import { randomUUID } from 'node:crypto'
import { spawn as ptySpawn } from 'node-pty'
import type { ClientChannel } from 'ssh2'
import type { ProjectEntry, SshServerEntry } from '../../shared/ipc-contracts'
import type { TerminalInfo, TerminalProfile, TerminalProfileId } from '../../shared/ipc-contracts'
import { availableProfiles, defaultProfileId, resolveSpawn } from './profiles'
import type { ProfileAvailability } from './profiles'
import type { SshService } from '../ssh/ssh-service'

export interface TerminalEvents {
  onData: (id: string, data: string) => void
  onExit: (id: string, code: number) => void
}

/** Минимальный pty-интерфейс терминала: node-pty IPty или SSH shell-канал. */
export interface PtyLike {
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(cb: (data: string) => void): void
  onExit(cb: (e: { exitCode: number }) => void): void
}

export type PtySpawner = (file: string, args: string[], cwd: string) => PtyLike
export type SshPtySpawner = (server: SshServerEntry, cwd: string) => Promise<PtyLike>

export interface TerminalProfilesResult {
  profiles: TerminalProfile[]
  defaultProfileId: TerminalProfileId
}

function defaultSpawner(file: string, args: string[], cwd: string): PtyLike {
  return ptySpawn(file, args, { name: 'xterm-256color', cwd })
}

/** SSH shell-канал под PtyLike; cwd задаётся первой командой `cd`. */
export function createSshPty(ssh: SshService, server: SshServerEntry, cwd: string): Promise<PtyLike> {
  return ssh.shell(server, { cols: 80, rows: 24 }).then((channel) => {
    adaptSshChannel(channel, cwd)
    return channelAdapter(channel)
  })
}

function adaptSshChannel(channel: ClientChannel, cwd: string): void {
  if (cwd.length > 0) channel.write(`cd ${cwd.replace(/'/g, "'\\''")} && clear\n`)
}

function channelAdapter(channel: ClientChannel): PtyLike {
  return {
    write: (data: string) => channel.write(data),
    resize: (cols: number, rows: number) => channel.setWindow(Math.floor(rows), Math.floor(cols), 0, 0),
    kill: () => {
      channel.close()
      channel.destroy()
    },
    onData: (cb: (data: string) => void) => {
      channel.on('data', (chunk: Buffer | string) => cb(chunk.toString('utf8')))
    },
    onExit: (cb: (e: { exitCode: number }) => void) => {
      let code = 0
      channel.on('exit', (exitCode: number | null) => {
        code = typeof exitCode === 'number' ? exitCode : 0
      })
      channel.on('close', () => cb({ exitCode: code }))
    }
  }
}

export class TerminalService {
  private readonly terms = new Map<string, { pty: PtyLike; info: TerminalInfo }>()

  constructor(
    private readonly events: TerminalEvents,
    private readonly spawnPty: PtySpawner = defaultSpawner,
    private readonly spawnSshPty: SshPtySpawner | null = null
  ) {}

  profiles(project: ProjectEntry, avail: ProfileAvailability): TerminalProfilesResult {
    return { profiles: availableProfiles(project, avail), defaultProfileId: defaultProfileId(project.kind, avail) }
  }

  async create(project: ProjectEntry, profileId: TerminalProfileId | null, avail: ProfileAvailability): Promise<TerminalInfo | null> {
    const id = profileId ?? defaultProfileId(project.kind, avail)
    const label = availableProfiles(project, avail).find((p) => p.id === id)?.label ?? id
    const info: TerminalInfo = { id: randomUUID(), profileId: id, label }
    let pty: PtyLike
    if (id === 'ssh') {
      if (project.kind !== 'ssh' || avail.sshServer === null || this.spawnSshPty === null) return null
      pty = await this.spawnSshPty(avail.sshServer, project.dir)
    } else {
      const resolved = await resolveSpawn(project, id, avail)
      if (resolved === null) return null
      pty = this.spawnPty(resolved.file, resolved.args, resolved.cwd)
    }
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
