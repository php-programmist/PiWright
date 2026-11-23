/** Профили терминала: PowerShell, cmd, Git Bash, WSL-дистрибутив. cwd — каталог проекта;
 *  для WSL — путь внутри дистрибутива (`wslPathFor`). Доступность: powershell всегда,
 *  git bash — по найденному bash.exe, wsl — по дистрибутиву. */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { BackendMode, ProjectEntry, Settings } from '../../shared/ipc-contracts'
import type { TerminalProfile, TerminalProfileId } from '../../shared/ipc-contracts'
import { listWslDistros, wslPathFor } from '../pi/backends/wsl'

export interface ProfileAvailability {
  gitBashPath: string | null
  wslDistro: string | null
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

export async function profileAvailability(settings: Settings): Promise<ProfileAvailability> {
  const distros = await listWslDistros()
  const wslDistro = settings.wslDistro.trim() || distros[0]
  return { gitBashPath: findGitBash(), wslDistro: wslDistro ?? null }
}

export function availableProfiles(avail: ProfileAvailability): TerminalProfile[] {
  const profiles: TerminalProfile[] = [{ id: 'powershell', label: 'PowerShell' }, { id: 'cmd', label: 'cmd' }]
  if (avail.gitBashPath !== null) profiles.push({ id: 'gitbash', label: 'Git Bash' })
  if (avail.wslDistro !== null) profiles.push({ id: 'wsl', label: avail.wslDistro })
  return profiles
}

export function defaultProfileId(kind: BackendMode, avail: ProfileAvailability): TerminalProfileId {
  if (kind === 'wsl' && avail.wslDistro !== null) return 'wsl'
  return 'powershell'
}

export async function resolveSpawn(
  project: ProjectEntry,
  profileId: TerminalProfileId,
  avail: ProfileAvailability,
  resolveWslCwd: (distro: string, hostPath: string) => Promise<string | null> = wslPathFor
): Promise<ResolvedSpawn | null> {
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
