/** Общая часть вшитых pi-расширений PiWright: каталог в fs бэкенда проекта и выкладка файлов
 *  по маркеру версии. Каталоги лежат вне `~/.pi/agent/extensions` — расширения грузятся только
 *  из сессий PiWright (через `pi -e`), а не из любой сессии pi в терминале. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type { ProjectEntry, Settings } from '../../shared/ipc-contracts'
import { listWslDistros, resolveWslHome } from './backends/wsl'

/** Каталог расширения `<name>` в fs бэкенда; null — бэкенд недоступен. */
export async function piwrightExtensionDir(
  project: ProjectEntry,
  settings: Settings,
  name: string
): Promise<string | null> {
  if (project.kind === 'native') {
    return join(homedir(), '.pi', 'agent', 'piwright', name)
  }
  const distro = settings.wslDistro.trim() || (await listWslDistros())[0]
  if (distro === undefined) return null
  const home = await resolveWslHome(distro)
  if (home === null) return null
  return join(`\\\\wsl.localhost\\${distro}`, home, '.pi', 'agent', 'piwright', name)
}

/** Выкладывает файлы расширения, если маркер версии не совпадает; возвращает каталог. */
export async function installBundledExtension(
  dir: string,
  version: string,
  files: Record<string, string>
): Promise<string> {
  try {
    const current = (await readFile(join(dir, '.version'), 'utf8')).trim()
    if (current === version) return dir
  } catch {
    // нет маркера — ставим заново
  }
  await mkdir(dir, { recursive: true })
  for (const [rel, text] of Object.entries(files)) {
    const target = join(dir, ...rel.split('/'))
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, text, 'utf8')
  }
  await writeFile(join(dir, '.version'), `${version}\n`, 'utf8')
  return dir
}
