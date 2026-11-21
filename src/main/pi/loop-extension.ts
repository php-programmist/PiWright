/** Вшитое pi-расширение `loop` (инструмент `loop_next`): verbatim-копия `resources/loop`,
 *  выкладывается в каталог бэкенда проекта, путь уходит в `pi -e`. */
import type { ProjectEntry, Settings } from '../../shared/ipc-contracts'
import { installBundledExtension, piwrightExtensionDir } from './bundled-extensions'
import loopIndexTs from '../../../resources/loop/index.ts?raw'

export const LOOP_EXTENSION_VERSION = 'loop-1'
/** Имя инструмента петли; дублирует константу в resources/loop/index.ts (verbatim-копия грузится только pi). */
export const LOOP_TOOL_NAME = 'loop_next'

const LOOP_EXTENSION_FILES: Record<string, string> = {
  'index.ts': loopIndexTs
}

/** Выкладывает файлы расширения, если маркер версии не совпадает; возвращает каталог. */
export async function installLoopExtension(dir: string): Promise<string> {
  return installBundledExtension(dir, LOOP_EXTENSION_VERSION, LOOP_EXTENSION_FILES)
}

/** Путь для `pi -e`; null — поставить не удалось (сессия стартует без инструмента петли). */
export async function ensureLoopExtension(project: ProjectEntry, settings: Settings): Promise<string | null> {
  try {
    const dir = await piwrightExtensionDir(project, settings, 'loop')
    if (dir === null) return null
    return await installLoopExtension(dir)
  } catch {
    return null
  }
}
