/** mcp.json: чтение/запись/показ/живая проверка серверов. Скоупы: юзерский каталог агента
 *  бэкенда проекта (`~/.pi/agent/mcp.json`; WSL — по UNC, ssh — SFTP) и `.pi/mcp.json` проекта.
 *  Схема — docs pi: `{mcpServers: {name: {command|url, ...}}}`. */
import { promises as fs } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { homedir } from 'node:os'
import type { McpListResult, McpOpResult, McpProbeResult, McpScope, McpServerEntry, ProjectEntry, Settings } from '../../shared/ipc-contracts'
import { resolveWslHome } from '../pi/backends/wsl'
import { getProjectFs, resolveBackendHome, hostProjectFs, type ProjectFs } from '../fs/project-fs'
import { probeMcp } from './mcp-probe'
import { errorMessage } from '../../shared/errors'

const NAME_PATTERN = /^[A-Za-z0-9_-]+$/

/** Цель операций mcp.json: ФС + путь. */
export interface McpFileTarget {
  pfs: ProjectFs
  file: string
}

/** Хост-путь mcp.json (Windows-каталог, UNC или POSIX на сервере); null — не резолвится. */
export async function mcpFilePath(project: ProjectEntry, scope: McpScope, settings: Settings): Promise<string | null> {
  const target = await mcpFileTarget(project, scope, settings)
  return target?.file ?? null
}

export async function mcpFileTarget(project: ProjectEntry, scope: McpScope, settings: Settings): Promise<McpFileTarget | null> {
  if (scope === 'project') {
    const pfs = project.kind === 'ssh' ? getProjectFs(project, settings) : hostProjectFs
    return { pfs, file: pfs.join(project.dir, '.pi', 'mcp.json') }
  }
  if (project.kind === 'native') return { pfs: hostProjectFs, file: join(homedir(), '.pi', 'agent', 'mcp.json') }
  if (project.kind === 'ssh') {
    const home = await resolveBackendHome(project, settings)
    if (home === null) return null
    return { pfs: getProjectFs(project, settings), file: posix.join(home, '.pi', 'agent', 'mcp.json') }
  }
  const distro = settings.wslDistro.trim() || project.dir.match(/^\\\\wsl\.localhost\\([^\\]+)/)?.[1] || ''
  if (distro.length === 0) return null
  const home = await resolveWslHome(distro)
  if (home === null) return null
  return { pfs: hostProjectFs, file: `\\\\wsl.localhost\\${distro}${home}\\.pi\\agent\\mcp.json`.replace(/\//g, '\\') }
}

function parseServers(raw: unknown): { servers: McpServerEntry[]; rest: Record<string, unknown> } {
  const rest: Record<string, unknown> =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const map = rest['mcpServers']
  const servers: McpServerEntry[] = []
  if (map !== null && typeof map === 'object' && !Array.isArray(map)) {
    for (const [name, config] of Object.entries(map as Record<string, unknown>)) {
      if (config !== null && typeof config === 'object' && !Array.isArray(config)) {
        servers.push({ name, config: config as Record<string, unknown> })
      }
    }
  }
  return { servers, rest }
}

export async function listMcpServers(project: ProjectEntry, scope: McpScope, settings: Settings): Promise<McpListResult> {
  const target = await mcpFileTarget(project, scope, settings)
  if (target === null) return { ok: false, error: 'Cannot resolve mcp.json path', file: '', exists: false, servers: [] }
  try {
    const raw: unknown = JSON.parse(await target.pfs.readText(target.file))
    const { servers } = parseServers(raw)
    return { ok: true, error: null, file: target.file, exists: true, servers }
  } catch {
    return { ok: true, error: null, file: target.file, exists: false, servers: [] }
  }
}

export async function saveMcpServers(
  project: ProjectEntry,
  scope: McpScope,
  settings: Settings,
  input: unknown
): Promise<McpOpResult> {
  const target = await mcpFileTarget(project, scope, settings)
  if (target === null) return { ok: false, error: 'Cannot resolve mcp.json path' }
  const file = target.file
  if (!Array.isArray(input)) return { ok: false, error: 'Invalid servers list' }
  const map: Record<string, unknown> = {}
  for (const item of input) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return { ok: false, error: 'Invalid server entry' }
    const record = item as Record<string, unknown>
    const name = record['name']
    const config = record['config']
    if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
      return { ok: false, error: `Invalid server name: ${String(name)}` }
    }
    if (config === null || typeof config !== 'object' || Array.isArray(config)) {
      return { ok: false, error: `Invalid config for ${name}` }
    }
    map[name] = config
  }
  let rest: Record<string, unknown> = {}
  try {
    const raw: unknown = JSON.parse(await target.pfs.readText(file))
    rest = parseServers(raw).rest
  } catch {
    // файла нет — пишем новый
  }
  rest['mcpServers'] = map
  try {
    await target.pfs.mkdir(target.pfs.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    await target.pfs.writeFile(tmp, JSON.stringify(rest, null, 2) + '\n')
    await target.pfs.renameOverwrite(tmp, file)
    return { ok: true, error: null }
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
}

export async function revealMcpFile(project: ProjectEntry, scope: McpScope, settings: Settings, openPath: (path: string) => Promise<string>): Promise<McpOpResult> {
  if (project.kind === 'ssh') return { ok: false, error: 'Cannot open a remote file in the editor' }
  const target = await mcpFileTarget(project, scope, settings)
  if (target === null) return { ok: false, error: 'Cannot resolve mcp.json path' }
  const file = target.file
  try {
    await fs.access(file)
  } catch {
    try {
      await fs.mkdir(dirname(file), { recursive: true })
      await fs.writeFile(file, JSON.stringify({ mcpServers: {} }, null, 2) + '\n', 'utf8')
    } catch (err) {
      return { ok: false, error: errorMessage(err) }
    }
  }
  const error = await openPath(file)
  return error.length > 0 ? { ok: false, error } : { ok: true, error: null }
}

export async function probeMcpServer(
  project: ProjectEntry,
  scope: McpScope,
  settings: Settings,
  name: string
): Promise<McpProbeResult> {
  const list = await listMcpServers(project, scope, settings)
  const entry = list.servers.find((s) => s.name === name)
  if (entry === undefined) return { ok: false, error: 'Server not found', toolCount: 0, serverError: null }
  if (project.kind === 'ssh') return { ok: false, error: 'MCP probe is not supported over SSH yet', toolCount: 0, serverError: null }
  const wslCwd = project.kind === 'wsl' ? await wslProjectPath(project, settings) : null
  return probeMcp(entry.config, project.kind === 'wsl' ? { distro: distroOf(project, settings), cwd: wslCwd } : null)
}

async function wslProjectPath(project: ProjectEntry, settings: Settings): Promise<string | null> {
  const { wslPathFor } = await import('../pi/backends/wsl')
  return wslPathFor(distroOf(project, settings), project.dir)
}

function distroOf(project: ProjectEntry, settings: Settings): string {
  return settings.wslDistro.trim() || project.dir.match(/^\\\\wsl\.localhost\\([^\\]+)/)?.[1] || ''
}
