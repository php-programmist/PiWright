/** Меню приложения: File → Настройки (открывает оверлей настроек в renderer) + Exit,
 *  дальше стандартные роли Edit/View/Window. Пересобирается при смене языка. */
import { Menu } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { APP_MENU_SETTINGS_CHANNEL, APP_MENU_STATS_CHANNEL } from '../shared/ipc-contracts'
import type { UiLanguage } from '../shared/ipc-contracts'
import type { EventBroadcaster } from './ipc/events'

const LABELS: Record<UiLanguage, { file: string; settings: string; statistics: string; exit: string }> = {
  en: { file: 'File', settings: 'Settings', statistics: 'Statistics', exit: 'Exit' },
  ru: { file: 'Файл', settings: 'Настройки', statistics: 'Статистика', exit: 'Выход' }
}

export function installAppMenu(getLang: () => UiLanguage, events: EventBroadcaster): () => void {
  const build = (): void => {
    const l = LABELS[getLang()]
    const isMac = process.platform === 'darwin'
    const fileSubmenu: MenuItemConstructorOptions[] = [
      {
        label: l.settings,
        accelerator: 'CmdOrCtrl+,',
        click: () => events.emit(APP_MENU_SETTINGS_CHANNEL)
      },
      {
        label: l.statistics,
        accelerator: 'CmdOrCtrl+Shift+S',
        click: () => events.emit(APP_MENU_STATS_CHANNEL)
      }
    ]
    if (!isMac) {
      fileSubmenu.push({ type: 'separator' }, { role: 'quit', label: l.exit })
    }
    const template: MenuItemConstructorOptions[] = [
      ...(isMac ? [{ role: 'appMenu' as const }] : []),
      { label: l.file, submenu: fileSubmenu },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' }
    ]
    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  }
  build()
  return build
}
