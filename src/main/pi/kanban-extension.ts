/** Вшитое pi-расширение `kanban` (туы канбан-доски): verbatim-копия `resources/kanban`,
 *  выкладывается в каталог бэкенда проекта, путь уходит в `pi -e` при включённом kanbanEnabled. */
import type { ProjectEntry, Settings } from '../../shared/ipc-contracts'
import { installBundledExtension, piwrightExtensionDir } from './bundled-extensions'
import kanbanIndexTs from '../../../resources/kanban/index.ts?raw'
import kanbanCoreTs from '../../../resources/kanban/lib/core.ts?raw'
import kanbanRootTs from '../../../resources/kanban/lib/root.ts?raw'
import kanbanStoreTs from '../../../resources/kanban/lib/store.ts?raw'
import kanbanToolsTs from '../../../resources/kanban/lib/tools.ts?raw'

export const KANBAN_EXTENSION_VERSION = 'kanban-6'

const KANBAN_EXTENSION_FILES: Record<string, string> = {
  'index.ts': kanbanIndexTs,
  'lib/core.ts': kanbanCoreTs,
  'lib/root.ts': kanbanRootTs,
  'lib/store.ts': kanbanStoreTs,
  'lib/tools.ts': kanbanToolsTs
}

/** Выкладывает файлы расширения, если маркер версии не совпадает; возвращает каталог. */
export async function installKanbanExtension(dir: string): Promise<string> {
  return installBundledExtension(dir, KANBAN_EXTENSION_VERSION, KANBAN_EXTENSION_FILES)
}

/** Путь для `pi -e`; null — поставить не удалось (сессия стартует без расширения). */
export async function ensureKanbanExtension(
  project: ProjectEntry,
  settings: Settings
): Promise<string | null> {
  try {
    const dir = await piwrightExtensionDir(project, settings, 'kanban')
    if (dir === null) return null
    return await installKanbanExtension(dir)
  } catch {
    return null
  }
}
