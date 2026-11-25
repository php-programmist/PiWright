/** Навыки pi: список SKILL.md (юзерские каталога агента бэкенда проекта + проектные
 *  `.pi/skills` и `.agents/skills`), тогглы через массив `skills` в settings.json бэкенда
 *  (запись `-<путь>` отключает навык). Формат frontmatter — docs pi (name, description).
 *  Чтение — через ProjectFs (ssh-проекты — SFTP). */
import { promises as fs } from 'node:fs'
import { join, posix } from 'node:path'
import { homedir } from 'node:os'
import { shell } from 'electron'
import type { McpOpResult, ProjectEntry, Settings, SkillEntry } from '../../shared/ipc-contracts'
import { stripWslUncPrefix } from '../pi/backends/shell'
import { resolveWslHome } from '../pi/backends/wsl'
import { getProjectFs, hostProjectFs, resolveBackendHome, type ProjectFs } from '../fs/project-fs'

const MAX_SCAN_DEPTH = 3

interface AgentPaths {
  agentDir: string
  settingsFile: string
  pfs: ProjectFs
}

async function agentPathsOf(project: ProjectEntry, settings: Settings): Promise<AgentPaths | null> {
  if (project.kind === 'native') {
    const agentDir = join(homedir(), '.pi', 'agent')
    return { agentDir, settingsFile: join(agentDir, 'settings.json'), pfs: hostProjectFs }
  }
  if (project.kind === 'ssh') {
    const home = await resolveBackendHome(project, settings)
    if (home === null) return null
    const pfs = getProjectFs(project, settings)
    const agentDir = posix.join(home, '.pi', 'agent')
    return { agentDir, settingsFile: posix.join(agentDir, 'settings.json'), pfs }
  }
  const distro = settings.wslDistro.trim() || project.dir.match(/^\\\\wsl\.localhost\\([^\\]+)/)?.[1] || ''
  if (distro.length === 0) return null
  const home = await resolveWslHome(distro)
  if (home === null) return null
  const wslAgentDir = `${home}/.pi/agent`
  const unc = `\\\\wsl.localhost\\${distro}${wslAgentDir.replace(/\//g, '\\')}`
  return { agentDir: unc, settingsFile: `${unc}\\settings.json`, pfs: hostProjectFs }
}

/** Frontmatter SKILL.md: `---` … `---`, поля name/description. null — не навык. */
export async function parseSkillMd(file: string): Promise<{ name: string; description: string } | null> {
  return parseSkillMdIn(hostProjectFs, file)
}

async function parseSkillMdIn(pfs: ProjectFs, file: string): Promise<{ name: string; description: string } | null> {
  let text: string
  try {
    text = await pfs.readText(file)
  } catch {
    return null
  }
  if (!text.startsWith('---')) return null
  const end = text.indexOf('\n---', 3)
  if (end < 0) return null
  const frontmatter = text.slice(3, end)
  let name: string | null = null
  let description = ''
  for (const line of frontmatter.split('\n')) {
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const key = line.slice(0, colon).trim()
    const value = line.slice(colon + 1).trim()
    if (key === 'name' && value.length > 0) name = value
    if (key === 'description') description = value
  }
  if (name === null) return null
  return { name, description }
}

/** Ключ отключения в массиве `skills`: путь относительно каталога агента для юзерских
 *  (`skills/<name>/SKILL.md`), полный backend-путь для проектных. */
export function disableKeyFor(agentDir: string, projectDir: string, skillFile: string): string | null {
  const normalized = skillFile.replaceAll('\\', '/')
  const agentPrefix = `${agentDir.replaceAll('\\', '/')}/`
  if (normalized.startsWith(agentPrefix)) return normalized.slice(agentPrefix.length)
  const projectWsl = stripWslUncPrefix(projectDir)
  if (projectWsl !== null) {
    const wsl = stripWslUncPrefix(skillFile)
    if (wsl !== null) return wsl
  } else if (normalized.startsWith(`${projectDir.replaceAll('\\', '/')}/`)) {
    return normalized
  }
  return null
}

async function disabledKeys(pfs: ProjectFs, settingsFile: string): Promise<Set<string>> {
  try {
    const raw: unknown = JSON.parse(await pfs.readText(settingsFile))
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return new Set()
    const skills = (raw as Record<string, unknown>)['skills']
    if (!Array.isArray(skills)) return new Set()
    return new Set(skills.filter((s): s is string => typeof s === 'string' && s.startsWith('-')).map((s) => s.slice(1)))
  } catch {
    return new Set()
  }
}

async function scanSkillDir(
  pfs: ProjectFs,
  hostPath: string,
  source: 'user' | 'project',
  agentDir: string,
  projectDir: string,
  disabled: Set<string>
): Promise<SkillEntry[]> {
  const result: SkillEntry[] = []
  const walk = async (current: string, depth: number): Promise<void> => {
    if (depth > MAX_SCAN_DEPTH) return
    let dirents
    try {
      dirents = await pfs.readdir(current)
    } catch {
      return
    }
    for (const entry of dirents) {
      if (!entry.isDir || entry.name === 'node_modules' || entry.name === '.git') continue
      const sub = pfs.join(current, entry.name)
      const skillFile = pfs.join(sub, 'SKILL.md')
      const skill = await parseSkillMdIn(pfs, skillFile)
      if (skill !== null) {
        const key = disableKeyFor(agentDir, projectDir, skillFile)
        result.push({ ...skill, path: skillFile, source, enabled: key === null ? true : !disabled.has(key) })
      }
      await walk(sub, depth + 1)
    }
  }
  await walk(hostPath, 0)
  return result
}

/** Ядро списка: явные пути (тесты зовут напрямую). */
export async function listSkillsIn(
  agentDir: string,
  settingsFile: string,
  projectDir: string,
  pfs: ProjectFs = hostProjectFs
): Promise<SkillEntry[]> {
  const disabled = await disabledKeys(pfs, settingsFile)
  const dirs: [string, 'user' | 'project'][] = [
    [pfs.join(agentDir, 'skills'), 'user'],
    [pfs.join(projectDir, '.pi', 'skills'), 'project'],
    [pfs.join(projectDir, '.agents', 'skills'), 'project']
  ]
  const skills: SkillEntry[] = []
  for (const [hostPath, source] of dirs) {
    skills.push(...(await scanSkillDir(pfs, hostPath, source, agentDir, projectDir, disabled)))
  }
  return skills
}

export async function listSkills(
  project: ProjectEntry,
  settings: Settings
): Promise<{ ok: boolean; error: string | null; skills: SkillEntry[] }> {
  const paths = await agentPathsOf(project, settings)
  if (paths === null) return { ok: false, error: 'Cannot resolve agent directory', skills: [] }
  return { ok: true, error: null, skills: await listSkillsIn(paths.agentDir, paths.settingsFile, project.dir, paths.pfs) }
}

/** Ядро тоггла: `-<key>` в массиве `skills` settings.json; остальное содержимое файла не трогаем. */
export async function toggleSkillIn(settingsFile: string, key: string, enabled: boolean, pfs: ProjectFs = hostProjectFs): Promise<McpOpResult> {
  let raw: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(await pfs.readText(settingsFile))
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>
  } catch {
    // файла нет — создаём с одним массивом skills
  }
  const current = Array.isArray(raw['skills']) ? raw['skills'].filter((s): s is string => typeof s === 'string') : []
  const next = current.filter((entry) => entry !== `-${key}`)
  if (!enabled) next.push(`-${key}`)
  raw['skills'] = next
  try {
    await pfs.mkdir(pfs.dirname(settingsFile), { recursive: true })
    const tmp = `${settingsFile}.tmp`
    await pfs.writeFile(tmp, JSON.stringify(raw, null, 2) + '\n')
    await pfs.renameOverwrite(tmp, settingsFile)
    return { ok: true, error: null }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function toggleSkill(project: ProjectEntry, settings: Settings, skillPath: string, enabled: boolean): Promise<McpOpResult> {
  const paths = await agentPathsOf(project, settings)
  if (paths === null) return { ok: false, error: 'Cannot resolve agent directory' }
  const key = disableKeyFor(paths.agentDir, project.dir, skillPath)
  if (key === null) return { ok: false, error: 'Skill is outside known skill directories' }
  return toggleSkillIn(paths.settingsFile, key, enabled, paths.pfs)
}

export async function revealSkillsFolder(project: ProjectEntry, settings: Settings, source: 'user' | 'project'): Promise<McpOpResult> {
  if (project.kind === 'ssh') return { ok: false, error: 'Cannot open a remote folder in the explorer' }
  const paths = await agentPathsOf(project, settings)
  if (paths === null) return { ok: false, error: 'Cannot resolve agent directory' }
  const dir = source === 'user' ? join(paths.agentDir, 'skills') : join(project.dir, '.pi', 'skills')
  try {
    await fs.mkdir(dir, { recursive: true })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  const error = await shell.openPath(dir)
  return error.length > 0 ? { ok: false, error } : { ok: true, error: null }
}
