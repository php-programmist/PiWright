/** Звуковые файлы уведомлений: чтение для renderer (Audio + data URL) и выбор диалогом.
 *  Форматы как в jb-pi NotificationSounds: wav/aif/aiff/au. */
import { dialog } from 'electron'
import { promises as fs } from 'node:fs'
import { extname } from 'node:path'
import type { SoundReadResult } from '../../shared/ipc-contracts'

const MAX_SOUND_BYTES = 2 * 1024 * 1024

const EXT_MIME: Record<string, string> = {
  '.wav': 'audio/wav',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
  '.au': 'audio/basic'
}

export function isPlayableAudioPath(path: string): boolean {
  return extname(path).toLowerCase() in EXT_MIME
}

export async function readSoundFile(path: string): Promise<SoundReadResult> {
  const empty: SoundReadResult = { ok: false, error: null, mime: '', base64: '' }
  if (path.trim().length === 0) return { ...empty, error: 'Sound is not configured' }
  if (!isPlayableAudioPath(path)) return { ...empty, error: 'Only wav / aif / aiff / au are supported' }
  try {
    const stat = await fs.stat(path)
    if (!stat.isFile()) return { ...empty, error: 'Not a regular file' }
    if (stat.size > MAX_SOUND_BYTES) return { ...empty, error: 'Sound file is too large' }
    const buffer = await fs.readFile(path)
    return { ok: true, error: null, mime: EXT_MIME[extname(path).toLowerCase()], base64: buffer.toString('base64') }
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : String(err) }
  }
}

export async function chooseSoundFile(): Promise<{ ok: boolean; error: string | null; path: string }> {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'Audio files', extensions: ['wav', 'aif', 'aiff', 'au'] }]
  })
  if (result.canceled || result.filePaths.length === 0) return { ok: false, error: null, path: '' }
  return { ok: true, error: null, path: result.filePaths[0] }
}
