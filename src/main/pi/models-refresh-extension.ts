/** Вшитое pi-расширение `models-refresh` (команда `/piwright-refresh-models`): verbatim-копия
 *  `resources/models-refresh`, выкладывается в каталог бэкенда проекта, путь уходит в `pi -e`.
 *  Команда перечитывает models.json в реестр моделей pi — снапшот `get_available_models`
 *  иначе живёт только до старта процесса. */
import type { ProjectEntry, Settings } from '../../shared/ipc-contracts'
import { installBundledExtension, piwrightExtensionDir } from './bundled-extensions'
import modelsRefreshIndexTs from '../../../resources/models-refresh/index.ts?raw'

export const MODELS_REFRESH_EXTENSION_VERSION = 'models-refresh-1'
/** Имя сервисной команды; дублирует константу в resources/models-refresh/index.ts (verbatim-копия грузится только pi). */
export const MODELS_REFRESH_COMMAND = 'piwright-refresh-models'

const MODELS_REFRESH_EXTENSION_FILES: Record<string, string> = {
  'index.ts': modelsRefreshIndexTs
}

/** Выкладывает файлы расширения, если маркер версии не совпадает; возвращает каталог. */
export async function installModelsRefreshExtension(dir: string): Promise<string> {
  return installBundledExtension(dir, MODELS_REFRESH_EXTENSION_VERSION, MODELS_REFRESH_EXTENSION_FILES)
}

/** Путь для `pi -e`; null — поставить не удалось (сессия стартует без команды рефреша). */
export async function ensureModelsRefreshExtension(
  project: ProjectEntry,
  settings: Settings
): Promise<string | null> {
  try {
    const dir = await piwrightExtensionDir(project, settings, 'models-refresh')
    if (dir === null) return null
    return await installModelsRefreshExtension(dir)
  } catch {
    return null
  }
}
