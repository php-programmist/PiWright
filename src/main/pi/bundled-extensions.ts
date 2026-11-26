/** Общая часть вшитых pi-расширений PiWright: каталог в fs бэкенда проекта и выкладка файлов
 *  по маркеру версии. Каталоги лежат вне `~/.pi/agent/extensions` — расширения грузятся только
 *  из сессий PiWright (через `pi -e`), а не из любой сессии pi в терминале. SSH-проекты —
 *  выкладка через SFTP (ProjectFs). */
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { ProjectEntry, Settings } from '../../shared/ipc-contracts'
import { listWslDistros, resolveWslHome } from './backends/wsl'
import { getProjectFs, hostProjectFs, resolveBackendHome, type ProjectFs } from '../fs/project-fs'

export interface ExtensionTarget {
  pfs: ProjectFs
  dir: string
}

/** Каталог расширения `<name>` в fs бэкенда; null — бэкенд/домой не резолвится. */
export async function piwrightExtensionTarget(
  project: ProjectEntry,
  settings: Settings,
  name: string
): Promise<ExtensionTarget | null> {
  if (project.kind === 'native') {
    return { pfs: hostProjectFs, dir: join(homedir(), '.pi', 'agent', 'piwright', name) }
  }
  if (project.kind === 'wsl') {
    const distro = settings.wslDistro.trim() || (await listWslDistros())[0]
    if (distro === undefined) return null
    const home = await resolveWslHome(distro)
    if (home === null) return null
    return { pfs: hostProjectFs, dir: join(`\\\\wsl.localhost\\${distro}`, home, '.pi', 'agent', 'piwright', name) }
  }
  const home = await resolveBackendHome(project, settings)
  if (home === null) return null
  const pfs = getProjectFs(project, settings)
  return { pfs, dir: pfs.join(home, '.pi', 'agent', 'piwright', name) }
}

/** Выкладывает файлы расширения, если маркер версии не совпадает; возвращает каталог. */
export async function installBundledExtension(
  pfs: ProjectFs,
  dir: string,
  version: string,
  files: Record<string, string>
): Promise<string> {
  try {
    const current = (await pfs.readText(pfs.join(dir, '.version'))).trim()
    if (current === version) return dir
  } catch {
    // нет маркера — ставим заново
  }
  await pfs.mkdir(dir, { recursive: true })
  for (const [rel, text] of Object.entries(files)) {
    const target = pfs.join(dir, ...rel.split('/'))
    await pfs.mkdir(pfs.dirname(target), { recursive: true })
    await pfs.writeFile(target, text)
  }
  await pfs.writeFile(pfs.join(dir, '.version'), `${version}\n`)
  return dir
}
