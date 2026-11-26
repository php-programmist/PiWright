/** Дефолтные звуки уведомлений по платформе. Windows — системные wav; Linux/macOS —
 *  свои wav из ресурсов (packaged: resources/sounds, dev: build/sounds). Чистый node —
 *  модуль импортируется настройками и демоном (ELECTRON_RUN_AS_NODE). */
import { posix } from 'node:path'

export type DefaultSoundName = 'completion' | 'await' | 'error'

const WIN_SOUNDS: Record<DefaultSoundName, string> = {
  completion: 'C:\\Windows\\Media\\Windows Notify System Generic.wav',
  await: 'C:\\Windows\\Media\\Windows Notify.wav',
  error: 'C:\\Windows\\Media\\Windows Exclamation.wav'
}

const BUNDLED_FILES: Record<DefaultSoundName, string> = {
  completion: 'notify-complete.wav',
  await: 'notify-await.wav',
  error: 'notify-error.wav'
}

/** Каталог своих wav: packaged — resources/sounds (в dev resourcesPath указывает в
 *  node_modules/electron/dist — файлов там нет, берём build/sounds от корня проекта). */
export function bundledSoundsDir(resourcesPath?: string): string {
  const res = resourcesPath ?? (process as { resourcesPath?: string }).resourcesPath
  if (res !== undefined && res.length > 0 && !res.includes('node_modules')) return posix.join(res, 'sounds')
  return posix.join(process.cwd().replaceAll('\\', '/'), 'build', 'sounds')
}

export function defaultSoundPaths(
  resourcesPath: string | undefined = (process as { resourcesPath?: string }).resourcesPath
): Record<DefaultSoundName, string> {
  if (process.platform === 'win32') return { ...WIN_SOUNDS }
  const dir = bundledSoundsDir(resourcesPath)
  return {
    completion: posix.join(dir, BUNDLED_FILES.completion),
    await: posix.join(dir, BUNDLED_FILES.await),
    error: posix.join(dir, BUNDLED_FILES.error)
  }
}
