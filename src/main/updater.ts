/** Проверка обновлений (electron-updater, generic-провайдер). Только в упакованном приложении;
 *  проверка включается, только если в настройках задан updateUrl (иначе — фид-плейсхолдер
 *  из electron-builder недостижим). Автозагрузка выключена: о найденной версии сообщается в UI,
 *  установка — в два шага: «Скачать», затем «Перезапустить, чтобы обновить» (quitAndInstall
 *  только по явному клику). Версия, скрытая «Не предлагать эту версию»,
 *  не показывается до выхода более новой. */
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { DEFAULT_SETTINGS } from './settings/settings'
import type { SettingsService } from './settings/settings'
import type { UpdateStatus } from '../shared/ipc-contracts'

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

/** В headless-хосте (чистый node) import из 'electron' даёт undefined — апдейтер недоступен.
 *  Веб-режим обновляется перезапуском сервера; проверка версий — changelog-канал (fetch API). */
const electronApp = app as typeof app | undefined

let status: UpdateStatus = { availableVersion: null, phase: 'idle' }
let notify: ((status: UpdateStatus) => void) | null = null

function setStatus(next: UpdateStatus): void {
  status = next
  notify?.(status)
}

/** Найдено обновление: версия, скрытая пользователем, не показывается. */
function handleAvailable(version: string, settings: SettingsService): void {
  const dismissed = settings.get().dismissedUpdateVersion
  setStatus(
    dismissed === version
      ? { availableVersion: null, phase: 'idle' }
      : { availableVersion: version, phase: 'idle' }
  )
}

export function startAutoUpdater(
  getUpdateUrl: () => string,
  settings: SettingsService,
  onStatus: (status: UpdateStatus) => void
): void {
  notify = onStatus
  if (electronApp === undefined || !electronApp.isPackaged) return
  const url = getUpdateUrl().trim() || DEFAULT_SETTINGS.updateUrl
  if (url.length === 0) return
  try {
    autoUpdater.setFeedURL({ provider: 'generic', url })
    autoUpdater.logger = console
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.on('update-available', (info) => handleAvailable(info.version, settings))
    autoUpdater.on('update-not-available', () => setStatus({ availableVersion: null, phase: 'idle' }))
    autoUpdater.on('update-downloaded', () => {
      // ждём явного «Перезапустить, чтобы обновить» — сами приложение не закрываем
      setStatus({ ...status, phase: 'downloaded' })
    })
    autoUpdater.on('error', () => {
      if (status.phase === 'downloading') setStatus({ ...status, phase: 'error' })
    })
    void autoUpdater.checkForUpdates().catch(() => {})
    setInterval(() => {
      void autoUpdater.checkForUpdates().catch(() => {})
    }, CHECK_INTERVAL_MS).unref()
  } catch {
    // кривой URL/конфиг — обновление не критично, приложение продолжает работать
  }
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

/** Кнопка «Скачать»: загрузка вручную, после — фаза downloaded и кнопка перезапуска. */
export function downloadUpdate(): UpdateStatus {
  if (electronApp === undefined || !electronApp.isPackaged || status.availableVersion === null || status.phase !== 'idle') return status
  setStatus({ ...status, phase: 'downloading' })
  void autoUpdater.downloadUpdate().catch(() => {})
  return status
}

/** Кнопка «Перезапустить, чтобы обновить»: выход и установка уже скачанного обновления. */
export function installUpdate(): UpdateStatus {
  if (electronApp === undefined || !electronApp.isPackaged || status.phase !== 'downloaded') return status
  autoUpdater.quitAndInstall()
  return status
}

/** «Не предлагать эту версию»: версия пишется в настройки, баннер скрывается до более новой. */
export function dismissUpdate(settings: SettingsService): UpdateStatus {
  if (status.availableVersion !== null) {
    settings.set({ dismissedUpdateVersion: status.availableVersion })
  }
  setStatus({ ...status, availableVersion: null })
  return status
}

/** Только dev (smoke): эмуляция найденного обновления тем же путём, что реальное событие;
 *  phase 'downloaded' — эмуляция завершённой загрузки (в dev downloadUpdate не работает). */
export function emitDevUpdate(version: string | null, settings: SettingsService, phase: 'idle' | 'downloaded' = 'idle'): UpdateStatus {
  if (electronApp === undefined || electronApp.isPackaged) return status
  if (version === null) setStatus({ availableVersion: null, phase: 'idle' })
  else handleAvailable(version, settings)
  if (phase === 'downloaded' && status.availableVersion !== null) setStatus({ ...status, phase: 'downloaded' })
  return status
}
