/** Чистая функция слияния снимка вкладок терминала проекта в настройки (shared — без side-effects). */
import type { Settings, TerminalTabsSnapshot } from './ipc-contracts'

export function setTerminalTabs(settings: Settings, key: string, snapshot: TerminalTabsSnapshot): Partial<Settings> {
  return { terminalTabs: { ...settings.terminalTabs, [key]: snapshot } }
}
