/** Вшитое pi-расширение `loop-stop` (инструмент `loop_stop`): verbatim-копия `resources/loop-stop`,
 *  выкладывается в каталог бэкенда проекта, путь уходит в `pi -e`. Агент зовёт инструмент в ответ
 *  на check-промпт контроллера петли, когда условие выхода выполнено. */
import type { ProjectEntry, Settings } from '../../shared/ipc-contracts'
import { installBundledExtension, piwrightExtensionDir } from './bundled-extensions'
import loopStopIndexTs from '../../../resources/loop-stop/index.ts?raw'

export const LOOP_STOP_EXTENSION_VERSION = 'loop-stop-2'
/** Имя инструмента выхода петли; дублирует константу в resources/loop-stop/index.ts (verbatim-копия грузится только pi). */
export const LOOP_STOP_TOOL_NAME = 'loop_stop'

const LOOP_STOP_EXTENSION_FILES: Record<string, string> = {
  'index.ts': loopStopIndexTs
}

/** Выкладывает файлы расширения, если маркер версии не совпадает; возвращает каталог. */
export async function installLoopStopExtension(dir: string): Promise<string> {
  return installBundledExtension(dir, LOOP_STOP_EXTENSION_VERSION, LOOP_STOP_EXTENSION_FILES)
}

/** Путь для `pi -e`; null — поставить не удалось (сессия стартует без инструмента выхода петли). */
export async function ensureLoopStopExtension(project: ProjectEntry, settings: Settings): Promise<string | null> {
  try {
    const dir = await piwrightExtensionDir(project, settings, 'loop-stop')
    if (dir === null) return null
    return await installLoopStopExtension(dir)
  } catch {
    return null
  }
}
