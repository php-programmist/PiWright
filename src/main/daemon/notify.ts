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

/** Проиграть wav; Windows — powershell SoundPlayer, Linux — paplay с фолбэком aplay (процесс
 *  одноразовый, демона не блокирует). Нет плеера/пустой путь — тишина. */
export function playSoundFile(path: string): void {
  if (path.trim().length === 0) return
  try {
    if (process.platform === 'win32') {
      const psq = `'${path.replace(/'/g, "''")}'`
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', `(New-Object Media.SoundPlayer -ArgumentList ${psq}).PlaySync()`],
        { stdio: 'ignore', windowsHide: true }
      )
      child.on('error', () => {})
      child.unref()
    } else if (process.platform === 'linux') {
      spawnPlayer('paplay', path)
    }
  } catch {
    // звук не критичен
  }
}

/** paplay отсутствует (минимальный дистрибутив без PulseAudio) — фолбэк aplay (ALSA, wav). */
function spawnPlayer(file: string, path: string, fallback?: string): void {
  try {
    const child = spawn(file, [path], { stdio: 'ignore' })
    child.on('error', () => {
      if (fallback !== undefined) spawnPlayer(fallback, path)
    })
    child.unref()
  } catch {
    if (fallback !== undefined) spawnPlayer(fallback, path)
  }
}

/** Имя проекта для текста уведомления: basename cwd из спеки спавна. */
export function projectLabel(projectDir: string): string {
  const trimmed = projectDir.replace(/[\\/]+$/, '')
  const base = basename(trimmed)
  return base.length > 0 ? base : trimmed
}
