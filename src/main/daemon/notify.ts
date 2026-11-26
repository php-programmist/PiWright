/** Фоновые уведомления демона: звук (Windows — powershell SoundPlayer) и telegram (raw fetch).
 *  Демон работает в режиме чистого Node (ELECTRON_RUN_AS_NODE) — electron-API недоступны,
 *  настройки читает сам из settings.json, токен бота получает в hello от main. */
import { spawn } from 'node:child_process'
import { basename } from 'node:path'
import type { Settings } from '../../shared/ipc-contracts'
import { SettingsService } from '../settings/settings'

/** Свежие настройки: файл маленький, события редкие — читаем на каждое уведомление. */
export function readDaemonSettings(settingsPath: string): Settings | null {
  try {
    return new SettingsService(settingsPath).get()
  } catch {
    return null
  }
}

/** Проиграть wav; Windows — powershell SoundPlayer (процесс одноразовый, демона не блокирует).
 *  Вне Windows и для пустого пути — тишина. */
export function playSoundFile(path: string): void {
  if (process.platform !== 'win32' || path.trim().length === 0) return
  const psq = `'${path.replace(/'/g, "''")}'`
  try {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `(New-Object Media.SoundPlayer -ArgumentList ${psq}).PlaySync()`],
      { stdio: 'ignore', windowsHide: true }
    )
    child.on('error', () => {})
    child.unref()
  } catch {
    // звук не критичен
  }
}

/** Имя проекта для текста уведомления: basename cwd из спеки спавна. */
export function projectLabel(projectDir: string): string {
  const trimmed = projectDir.replace(/[\\/]+$/, '')
  const base = basename(trimmed)
  return base.length > 0 ? base : trimmed
}
