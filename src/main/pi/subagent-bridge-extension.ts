/** Вшитое pi-расширение `subagent-bridge`: verbatim-копия `resources/subagent-bridge`,
 *  выкладывается в каталог бэкенда проекта, путь уходит в `pi -e`. pi-subagents анонсирует
 *  жизненный цикл субагентов через pi.events — шину расширение↔расширение, в RPC-stdout она
 *  не попадает. Мост подписывается на каналы и пересылает каждое событие как custom-entry
 *  (`entry_appended` в RPC-потоке), откуда транслятор достаёт активность субагентов для петли. */
import type { ProjectEntry, Settings } from '../../shared/ipc-contracts'
import { installBundledExtension, piwrightExtensionDir } from './bundled-extensions'
import subagentBridgeIndexTs from '../../../resources/subagent-bridge/index.ts?raw'

export const SUBAGENT_BRIDGE_EXTENSION_VERSION = 'subagent-bridge-1'

const SUBAGENT_BRIDGE_EXTENSION_FILES: Record<string, string> = {
  'index.ts': subagentBridgeIndexTs
}

/** Путь для `pi -e`; null — поставить не удалось (сессия стартует без моста). */
export async function ensureSubagentBridgeExtension(project: ProjectEntry, settings: Settings): Promise<string | null> {
  try {
    const dir = await piwrightExtensionDir(project, settings, 'subagent-bridge')
    if (dir === null) return null
    return await installBundledExtension(dir, SUBAGENT_BRIDGE_EXTENSION_VERSION, SUBAGENT_BRIDGE_EXTENSION_FILES)
  } catch {
    return null
  }
}
