/** Вшитое pi-расширение `ask_question` (порт `core/PiAskExtension.kt`): файлы — verbatim-копия
 *  jb-pi из `resources/ask-question`, выкладываются в каталог бэкенда проекта (см.
 *  `bundled-extensions.ts`), путь уходит в `pi -e`. */
import type { ProjectEntry, Settings } from '../../shared/ipc-contracts'
import { installBundledExtension, piwrightExtensionDir } from './bundled-extensions'
import askIndexTs from '../../../resources/ask-question/index.ts?raw'
import askLicense from '../../../resources/ask-question/LICENSE?raw'
import askNotice from '../../../resources/ask-question/NOTICE?raw'
import askCoreTs from '../../../resources/ask-question/src/core.ts?raw'
import askSchemaTs from '../../../resources/ask-question/src/schema.ts?raw'
import askDialogsTs from '../../../resources/ask-question/src/dialogs.ts?raw'
import askQuestionnaireTs from '../../../resources/ask-question/src/questionnaire.ts?raw'
import askTuiTs from '../../../resources/ask-question/src/tui.ts?raw'
import askExtensionTs from '../../../resources/ask-question/src/extension.ts?raw'
import askRpcTs from '../../../resources/ask-question/src/rpc.ts?raw'

export const ASK_EXTENSION_VERSION = 'ask-question-1'

const ASK_EXTENSION_FILES: Record<string, string> = {
  'index.ts': askIndexTs,
  LICENSE: askLicense,
  NOTICE: askNotice,
  'src/core.ts': askCoreTs,
  'src/schema.ts': askSchemaTs,
  'src/dialogs.ts': askDialogsTs,
  'src/questionnaire.ts': askQuestionnaireTs,
  'src/tui.ts': askTuiTs,
  'src/extension.ts': askExtensionTs,
  'src/rpc.ts': askRpcTs
}

/** Выкладывает файлы расширения, если маркер версии не совпадает; возвращает каталог. */
export async function installAskExtension(dir: string): Promise<string> {
  return installBundledExtension(dir, ASK_EXTENSION_VERSION, ASK_EXTENSION_FILES)
}

/** Путь для `pi -e`; null — поставить не удалось (сессия стартует без расширения, как в jb-pi). */
export async function ensureAskExtension(project: ProjectEntry, settings: Settings): Promise<string | null> {
  try {
    const dir = await piwrightExtensionDir(project, settings, 'ask-question')
    if (dir === null) return null
    return await installAskExtension(dir)
  } catch {
    return null
  }
}
