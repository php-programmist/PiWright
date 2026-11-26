/** Профили терминала: PowerShell, cmd, Git Bash, WSL-дистрибутив, SSH-сервер проекта;
 *  на Linux/macOS — bash/zsh/fish. cwd — каталог проекта; для WSL — путь внутри дистрибутива
 *  (`wslPathFor`). Доступность: powershell всегда (win32), git bash — по найденному bash.exe,
 *  wsl — по дистрибутиву, posix-шеллы — по наличию бинарника, ssh — по серверу проекта. */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { BackendMode, ProjectEntry, Settings, SshServerEntry } from '../../shared/ipc-contracts'
import type { TerminalProfile, TerminalProfileId } from '../../shared/ipc-contracts'
import { listWslDistros, wslPathFor } from '../pi/backends/wsl'

export interface ProfileAvailability {
  gitBashPath: string | null
  wslDistro: string | null
  sshServer: SshServerEntry | null
}

export interface ResolvedSpawn {
  file: string
  args: string[]
  cwd: string
}

function gitBashCandidates(): string[] {
  const candidates: string[] = []
  const programFiles = process.env['ProgramFiles']
  const programFilesX86 = process.env['ProgramFiles(x86)']
  const localAppData = process.env['LocalAppData']
  if (programFiles !== undefined) candidates.push(join(programFiles, 'Git', 'bin', 'bash.exe'))
  if (programFilesX86 !== undefined) candidates.push(join(programFilesX86, 'Git', 'bin', 'bash.exe'))
  if (localAppData !== undefined) candidates.push(join(localAppData, 'Programs', 'Git', 'bin', 'bash.exe'))
  return candidates
}

export function findGitBash(candidates: string[] = gitBashCandidates()): string | null {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** POSIX-шеллы: /usr/bin и /bin, первый найденный бинарник. */
export function availablePosixShells(platform: NodeJS.Platform = process.platform): TerminalProfile[] {
  if (platform === 'win32') return []
  const shells: TerminalProfile[] = []
  for (const [id, label] of [
    ['bash', 'bash'],
    ['zsh', 'zsh'],
    ['fish', 'fish']
  ] as const) {
    if (existsSync(join('/usr/bin', id)) || existsSync(join('/bin', id))) {
      shells.push({ id, label })
    }
  }
  return shells
}

export async function profileAvailability(settings: Settings, project?: ProjectEntry): Promise<ProfileAvailability> {
  if (process.platform !== 'win32') {
    return { gitBashPath: null, wslDistro: null, sshServer: project !== undefined && project.kind === 'ssh' ? (settings.sshServers.find((s) => s.id === project.serverId) ?? null) : null }
  }
  const distros = await listWslDistros()
  const wslDistro = settings.wslDistro.trim() || distros[0]
  const sshServer =
    project !== undefined && project.kind === 'ssh'
      ? (settings.sshServers.find((s) => s.id === project.serverId) ?? null)
      : null
  return { gitBashPath: findGitBash(), wslDistro: wslDistro ?? null, sshServer }
}

export function availableProfiles(project: ProjectEntry, avail: ProfileAvailability, isWindows: boolean = process.platform === 'win32'): TerminalProfile[] {
  const profiles: TerminalProfile[] = isWindows ? [{ id: 'powershell', label: 'PowerShell' }, { id: 'cmd', label: 'cmd' }] : availablePosixShells()
  if (isWindows && avail.gitBashPath !== null) profiles.push({ id: 'gitbash', label: 'Git Bash' })
  if (isWindows && avail.wslDistro !== null) profiles.push({ id: 'wsl', label: avail.wslDistro })
  if (project.kind === 'ssh' && avail.sshServer !== null) profiles.push({ id: 'ssh', label: avail.sshServer.name })
  return profiles
}

export function defaultProfileId(kind: BackendMode, avail: ProfileAvailability, isWindows: boolean = process.platform === 'win32'): TerminalProfileId {
  if (kind === 'ssh' && avail.sshServer !== null) return 'ssh'
  if (isWindows && kind === 'wsl' && avail.wslDistro !== null) return 'wsl'
  if (isWindows) return 'powershell'
  return availablePosixShells()[0]?.id ?? 'bash'
}

export async function resolveSpawn(
  project: ProjectEntry,
  profileId: TerminalProfileId,
  avail: ProfileAvailability,
  resolveWslCwd: (distro: string, hostPath: string) => Promise<string | null> = wslPathFor
): Promise<ResolvedSpawn | null> {
  if (profileId === 'ssh') return null // ssh-терминал создаётся через SshService (shell-канал), не file/args
  if (profileId === 'bash' || profileId === 'zsh' || profileId === 'fish') {
    return { file: profileId, args: ['-l'], cwd: project.dir }
  }
  if (profileId === 'powershell') {
    return { file: 'powershell.exe', args: ['-NoLogo'], cwd: project.dir }
  }
  if (profileId === 'cmd') {
    return { file: 'cmd.exe', args: [], cwd: project.dir }
  }
  if (profileId === 'gitbash') {
    if (avail.gitBashPath === null) return null
    return { file: avail.gitBashPath, args: ['-i', '-l'], cwd: project.dir }
  }
  if (avail.wslDistro === null) return null
  const distro = avail.wslDistro
  const wslCwd = await resolveWslCwd(distro, project.dir)
  return {
    file: 'wsl.exe',
    args: wslCwd === null ? ['-d', distro] : ['-d', distro, '--cd', wslCwd],
    cwd: project.dir
  }
}
