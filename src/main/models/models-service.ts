/** models.json бэкенда: чтение/запись/открытие в редакторе. native — `%USERPROFILE%\.pi\agent\models.json`,
 *  wsl — UNC `\\wsl.localhost\<distro><home>\.pi\agent\models.json`. Схема — docs pi: `{providers: {...}}`. */
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { shell } from 'electron'
import type { BackendMode, ModelsListResult, ModelsOpResult, Settings } from '../../shared/ipc-contracts'
import { listWslDistros, resolveWslHome } from '../pi/backends/wsl'

/** Хост-путь models.json (Windows-каталог или UNC); null — бэкенд/домой не резолвится.
 *  homeDir — инжект для тестов (по умолчанию — реальный homedir). */
export async function modelsFilePath(backend: BackendMode, settings: Settings, homeDir: string = homedir()): Promise<string | null> {
  if (backend === 'native') return join(homeDir, '.pi', 'agent', 'models.json')
  const distro = settings.wslDistro.trim() || (await listWslDistros())[0] || ''
  if (distro.length === 0) return null
  const home = await resolveWslHome(distro)
  if (home === null) return null
  return `\\\\wsl.localhost\\${distro}${home}\\.pi\\agent\\models.json`.replace(/\//g, '\\')
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

export async function listModels(backend: BackendMode, settings: Settings, homeDir: string = homedir()): Promise<ModelsListResult> {
  const file = await modelsFilePath(backend, settings, homeDir)
  if (file === null) return { ok: false, error: 'Cannot resolve models.json path', file: '', exists: false, doc: null }
  try {
    const doc: unknown = JSON.parse(await fs.readFile(file, 'utf8'))
    return { ok: true, error: null, file, exists: true, doc }
  } catch {
    return { ok: true, error: null, file, exists: false, doc: null }
  }
}

export async function saveModels(backend: BackendMode, settings: Settings, doc: unknown, homeDir: string = homedir()): Promise<ModelsOpResult> {
  const file = await modelsFilePath(backend, settings, homeDir)
  if (file === null) return { ok: false, error: 'Cannot resolve models.json path' }
  if (!docShapeOk(doc)) return { ok: false, error: 'Invalid models.json document' }
  try {
    await fs.mkdir(dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    await fs.writeFile(tmp, JSON.stringify(doc, null, 2) + '\n', 'utf8')
    await fs.rename(tmp, file)
    return { ok: true, error: null }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function revealModelsFile(backend: BackendMode, settings: Settings, homeDir: string = homedir()): Promise<ModelsOpResult> {
  const file = await modelsFilePath(backend, settings, homeDir)
  if (file === null) return { ok: false, error: 'Cannot resolve models.json path' }
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
