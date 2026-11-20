/** Установка вшитого pi-расширения `ask_question` в домашнюю директорию бэкенда проекта
 *  (`~/.pi/agent/piwright/ask-question`) и путь для `pi -e`. Порт `core/PiAskExtension.kt`:
 *  каталог вне `~/.pi/agent/extensions` — расширение живёт только в сессиях piwright.
 *  Файлы — verbatim-копия jb-pi (resources/ask-question), версия в `.version` — обновление. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type { ProjectEntry, Settings } from '../../shared/ipc-contracts'
import { listWslDistros, resolveWslHome } from './backends/wsl'
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

/** Каталог расширения в fs бэкенда; null — бэкенд недоступен. */
export async function askExtensionDir(project: ProjectEntry, settings: Settings): Promise<string | null> {
  if (project.kind === 'native') {
    return join(homedir(), '.pi', 'agent', 'piwright', 'ask-question')
  }
  const distro = settings.wslDistro.trim() || (await listWslDistros())[0]
  if (distro === undefined) return null
  const home = await resolveWslHome(distro)
  if (home === null) return null
  return join(`\\\\wsl.localhost\\${distro}`, home, '.pi', 'agent', 'piwright', 'ask-question')
}

/** Выкладывает файлы расширения, если маркер версии не совпадает; возвращает каталог. */
export async function installAskExtension(dir: string): Promise<string> {
  try {
    const current = (await readFile(join(dir, '.version'), 'utf8')).trim()
    if (current === ASK_EXTENSION_VERSION) return dir
  } catch {
    // нет маркера — ставим заново
  }
  await mkdir(dir, { recursive: true })
  for (const [rel, text] of Object.entries(ASK_EXTENSION_FILES)) {
    const target = join(dir, ...rel.split('/'))
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, text, 'utf8')
  }
  await writeFile(join(dir, '.version'), `${ASK_EXTENSION_VERSION}\n`, 'utf8')
  return dir
}

/** Путь для `pi -e`; null — поставить не удалось (сессия стартует без расширения, как в jb-pi). */
export async function ensureAskExtension(project: ProjectEntry, settings: Settings): Promise<string | null> {
  try {
    const dir = await askExtensionDir(project, settings)
    if (dir === null) return null
    return await installAskExtension(dir)
  } catch {
    return null
  }
}
