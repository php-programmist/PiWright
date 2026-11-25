/** models.json бэкенда: чтение/запись/открытие в редакторе. native — `%USERPROFILE%\.pi\agent\models.json`,
 *  wsl — UNC `\\wsl.localhost\<distro><home>\.pi\agent\models.json`, ssh — models.json на сервере
 *  (SFTP; «открыть в редакторе» для ssh недоступно). Схема — docs pi: `{providers: {...}}`. */
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { posix } from 'node:path'
import { homedir } from 'node:os'
import { shell } from 'electron'
import type { BackendMode, ModelsListResult, ModelsOpResult, Settings } from '../../shared/ipc-contracts'
import { listWslDistros, resolveWslHome } from '../pi/backends/wsl'
import { getSshService } from '../ssh/ssh-service'
import { getProjectFs, hostProjectFs, type ProjectFs } from '../fs/project-fs'

/** Цель операций models.json: ФС бэкенда + путь файла. */
export interface ModelsTarget {
  pfs: ProjectFs
  file: string
}

/** Хост-путь models.json (Windows-каталог или UNC); null — бэкенд/домой не резолвится.
 *  homeDir — инжект для тестов (по умолчанию — реальный homedir). */
export async function modelsFilePath(backend: BackendMode, settings: Settings, homeDir: string = homedir(), serverId?: string): Promise<string | null> {
  const target = await modelsTarget(backend, settings, homeDir, serverId)
  return target?.file ?? null
}

/** Цель models.json бэкенда; для ssh нужен serverId из settings.sshServers. */
export async function modelsTarget(backend: BackendMode, settings: Settings, homeDir: string = homedir(), serverId?: string): Promise<ModelsTarget | null> {
  if (backend === 'native') return { pfs: hostProjectFs, file: join(homeDir, '.pi', 'agent', 'models.json') }
  if (backend === 'ssh') {
    const server = settings.sshServers.find((s) => s.id === serverId)
    if (server === undefined) return null
    try {
      const home = await getSshService().homeDir(server)
      if (home === null) return null
      return { pfs: getProjectFs({ kind: 'ssh', dir: home, serverId: server.id }, settings), file: posix.join(home, '.pi', 'agent', 'models.json') }
    } catch {
      return null
    }
  }
  const distro = settings.wslDistro.trim() || (await listWslDistros())[0] || ''
  if (distro.length === 0) return null
  const home = await resolveWslHome(distro)
  if (home === null) return null
  return { pfs: hostProjectFs, file: `\\\\wsl.localhost\\${distro}${home}\\.pi\\agent\\models.json`.replace(/\//g, '\\') }
}

/** Лёгкая валидация формы: объект с providers-объектом; значения провайдеров — объекты, models — массивы. */
function docShapeOk(doc: unknown): boolean {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) return false
  const providers = (doc as Record<string, unknown>)['providers']
  if (providers === null || typeof providers !== 'object' || Array.isArray(providers)) return false
  for (const value of Object.values(providers as Record<string, unknown>)) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
    const models = (value as Record<string, unknown>)['models']
    if (models !== undefined && !Array.isArray(models)) return false
  }
  return true
}

export async function listModels(backend: BackendMode, settings: Settings, homeDir: string = homedir(), serverId?: string): Promise<ModelsListResult> {
  const target = await modelsTarget(backend, settings, homeDir, serverId)
  if (target === null) return { ok: false, error: 'Cannot resolve models.json path', file: '', exists: false, doc: null }
  return listModelsIn(target)
}

export async function listModelsIn(target: ModelsTarget): Promise<ModelsListResult> {
  try {
    const doc: unknown = JSON.parse(await target.pfs.readText(target.file))
    return { ok: true, error: null, file: target.file, exists: true, doc }
  } catch {
    return { ok: true, error: null, file: target.file, exists: false, doc: null }
  }
}

export async function saveModels(backend: BackendMode, settings: Settings, doc: unknown, homeDir: string = homedir(), serverId?: string): Promise<ModelsOpResult> {
  const target = await modelsTarget(backend, settings, homeDir, serverId)
  if (target === null) return { ok: false, error: 'Cannot resolve models.json path' }
  return saveModelsIn(target, doc)
}

export async function saveModelsIn(target: ModelsTarget, doc: unknown): Promise<ModelsOpResult> {
  if (!docShapeOk(doc)) return { ok: false, error: 'Invalid models.json document' }
  try {
    await target.pfs.mkdir(target.pfs.dirname(target.file), { recursive: true })
    const tmp = `${target.file}.tmp`
    await target.pfs.writeFile(tmp, JSON.stringify(doc, null, 2) + '\n')
    await target.pfs.renameOverwrite(tmp, target.file)
    return { ok: true, error: null }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function revealModelsFile(backend: BackendMode, settings: Settings, homeDir: string = homedir(), serverId?: string): Promise<ModelsOpResult> {
  if (backend === 'ssh') return { ok: false, error: 'Cannot open a remote file in the editor' }
  const target = await modelsTarget(backend, settings, homeDir, serverId)
  if (target === null) return { ok: false, error: 'Cannot resolve models.json path' }
  const file = target.file
  try {
    await fs.access(file)
  } catch {
    try {
      await fs.mkdir(dirname(file), { recursive: true })
      await fs.writeFile(file, JSON.stringify({ providers: {} }, null, 2) + '\n', 'utf8')
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
  const error = await shell.openPath(file)
  return error.length > 0 ? { ok: false, error } : { ok: true, error: null }
}
