/** Вшитое pi-расширение `session-tools` (инструмент `rename_session`): verbatim-копия
 *  `resources/session-tools`, выкладывается в каталог бэкенда проекта, путь уходит в `pi -e`. */
import type { ProjectEntry, Settings } from '../../shared/ipc-contracts'
import { installBundledExtension, piwrightExtensionTarget, type ExtensionTarget } from './bundled-extensions'
import sessionToolsIndexTs from '../../../resources/session-tools/index.ts?raw'

export const SESSION_TOOLS_EXTENSION_VERSION = 'session-tools-1'

const SESSION_TOOLS_EXTENSION_FILES: Record<string, string> = {
  'index.ts': sessionToolsIndexTs
}

/** Выкладывает файлы расширения, если маркер версии не совпадает; возвращает каталог. */
export async function installSessionToolsExtension(target: ExtensionTarget): Promise<string> {
  return installBundledExtension(target.pfs, target.dir, SESSION_TOOLS_EXTENSION_VERSION, SESSION_TOOLS_EXTENSION_FILES)
}

/** Путь для `pi -e`; null — поставить не удалось (сессия стартует без инструмента). */
export async function ensureSessionToolsExtension(
  project: ProjectEntry,
  settings: Settings
): Promise<string | null> {
  try {
    const target = await piwrightExtensionTarget(project, settings, 'session-tools')
    if (target === null) return null
    return await installSessionToolsExtension(target)
  } catch {
    return null
  }
}
