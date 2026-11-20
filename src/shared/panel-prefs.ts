/** Чистая функция слияния состояния панели в настройки (shared — без side-effects). */
import type { PanelName, PanelPrefs, Settings } from './ipc-contracts'

export function mergePanelPrefs(settings: Settings, panel: PanelName, patch: PanelPrefs): Partial<Settings> {
  return { panels: { ...settings.panels, [panel]: { ...settings.panels[panel], ...patch } } }
}
