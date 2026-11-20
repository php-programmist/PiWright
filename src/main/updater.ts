/** Автообновление (electron-updater, generic-провайдер). Только в упакованном приложении;
 *  проверка включается, только если в настройках задан updateUrl (иначе — фид-плейсхолдер
 *  из electron-builder недостижим). Тихая загрузка, уведомление — средствами electron-updater. */
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

export function startAutoUpdater(getUpdateUrl: () => string): void {
  if (!app.isPackaged) return
  const url = getUpdateUrl().trim()
  if (url.length === 0) return
  try {
    autoUpdater.setFeedURL({ provider: 'generic', url })
    autoUpdater.logger = console
    void autoUpdater.checkForUpdatesAndNotify().catch(() => {})
    setInterval(() => {
      void autoUpdater.checkForUpdatesAndNotify().catch(() => {})
    }, CHECK_INTERVAL_MS).unref()
  } catch {
    // кривой URL/конфиг — обновление не критично, приложение продолжает работать
  }
}
