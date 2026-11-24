/** Проигрывание звуков уведомлений в renderer: main отдаёт файл base64, кэш data URL по пути. */
import type { NotificationSounds } from '../../../shared/ipc-contracts'

const cache = new Map<string, string>()

/** hostId → время последнего turn_error: ход с ошибкой не озвучивается ещё и как завершённый. */
const lastErrorAt = new Map<string, number>()

const ERROR_SUPPRESS_MS = 5000

async function play(path: string): Promise<void> {
  if (path.trim().length === 0) return
  try {
    let url = cache.get(path)
    if (url === undefined) {
      const res = await window.piwright.soundsRead(path)
      if (!res.ok) {
        console.warn(`[sounds] не удалось прочитать ${path}: ${res.error}`)
        return
      }
      url = `data:${res.mime};base64,${res.base64}`
      cache.set(path, url)
    }
    await new Audio(url).play().catch((err) => console.warn('[sounds] play failed:', err))
  } catch (err) {
    console.warn('[sounds] не удалось проиграть', path, err)
  }
}

/** Превью выбранного звука из настроек. */
export function previewSound(path: string): void {
  void play(path)
}

/** Событие сессии → звук (настройки могут быть ещё не загружены — тогда тишина). */
export function playNotificationSound(hostId: string, kind: 'completion' | 'await' | 'error', sounds: NotificationSounds | undefined, muted: boolean): void {
  if (sounds === undefined || muted) return
  if (kind === 'error') lastErrorAt.set(hostId, Date.now())
  if (kind === 'completion' && Date.now() - (lastErrorAt.get(hostId) ?? 0) < ERROR_SUPPRESS_MS) return
  void play(sounds[kind])
}
