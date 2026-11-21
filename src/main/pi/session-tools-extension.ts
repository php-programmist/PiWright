/** Вшитое pi-расширение `session-tools` (инструмент `rename_session`): verbatim-копия
 *  `resources/session-tools`, выкладывается в каталог бэкенда проекта, путь уходит в `pi -e`. */
import type { ProjectEntry, Settings } from '../../shared/ipc-contracts'
import { installBundledExtension, piwrightExtensionDir } from './bundled-extensions'
import sessionToolsIndexTs from '../../../resources/session-tools/index.ts?raw'

export const SESSION_TOOLS_EXTENSION_VERSION = 'session-tools-1'

const SESSION_TOOLS_EXTENSION_FILES: Record<string, string> = {
  'index.ts': sessionToolsIndexTs
}

/** Выкладывает файлы расширения, если маркер версии не совпадает; возвращает каталог. */
export async function installSessionToolsExtension(dir: string): Promise<string> {
  return installBundledExtension(dir, SESSION_TOOLS_EXTENSION_VERSION, SESSION_TOOLS_EXTENSION_FILES)
}

/** Путь для `pi -e`; null — поставить не удалось (сессия стартует без инструмента). */
export async function ensureSessionToolsExtension(
  project: ProjectEntry,
  settings: Settings
): Promise<string | null> {
  try {
    const dir = await piwrightExtensionDir(project, settings, 'session-tools')
    if (dir === null) return null
    return await installSessionToolsExtension(dir)
  } catch {
    return null
  }
}
