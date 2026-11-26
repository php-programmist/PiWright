/** Вложения промпта: mime по расширению и безопасное имя файла. Порт `PiSession.imageMimeTypeForExtension` + `Attachments.kt`. */
import { splitWorktreeHostDir } from './worktree'

/** Картинки, которые pi умеет передать модели; остальное — файл-ссылкой в тексте. */
export function imageMimeTypeForExtension(ext: string): string | null {
  switch (ext.toLowerCase()) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'png':
      return 'image/png'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'bmp':
      return 'image/bmp'
    default:
      return null
  }
}

/** Путь в проекте указывает на картинку (для вкладки-просмотрщика). */
export function isImageFilePath(path: string): boolean {
  const ext = path.slice(path.lastIndexOf('.') + 1)
  return path.includes('.') && imageMimeTypeForExtension(ext) !== null
}

/** Имя файла внутри `.pi/attachments/`: плоское, без разделителей пути; буквы/цифры Unicode
 *  (кириллица и т.п.) сохраняются, прочие символы — в `_`. */
export function sanitizeAttachmentName(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N}._-]/gu, '_').replace(/^\.+/, '_').slice(0, 100)
  return cleaned.length > 0 ? cleaned : 'attachment'
}

/** Ссылка в тексте промпта — pi читает файл своим инструментом (`@file` в RPC-режиме — текстом).
 *  Вложения всегда лежат в общей папке корня репо `<root>/.pi/attachments/`; сессия в worktree
 *  (`<root>/.pi/worktrees/<name>`) имеет cwd внутри worktree — ref выходит на два уровня вверх. */
export function attachmentRef(projectDir: string, name: string): string {
  return splitWorktreeHostDir(projectDir) !== null ? `@../../.pi/attachments/${name}` : `@.pi/attachments/${name}`
}

export type AttachmentSegment = { kind: 'text'; text: string } | { kind: 'ref'; ref: string; name: string }

const ATTACHMENT_REF_RE = /@((?:\.\.\/)*\.pi\/attachments\/)([\p{L}\p{N}._-]+)/gu

/** Текст промпта → сегменты «текст / ref вложения» для рендера превью в чате. */
export function splitAttachmentRefs(text: string): AttachmentSegment[] {
  const segments: AttachmentSegment[] = []
  let last = 0
  for (const m of text.matchAll(ATTACHMENT_REF_RE)) {
    const idx = m.index ?? 0
    if (idx > last) segments.push({ kind: 'text', text: text.slice(last, idx) })
    segments.push({ kind: 'ref', ref: m[0], name: m[2] })
    last = idx + m[0].length
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) })
  return segments
}

/** Байты → base64 (paste картинки в renderer; чанками — лимит arg-стека String.fromCharCode). */
export function base64FromBytes(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** Убрать последнее вхождение ref вложения из текста промпта (удаление чипа картинки). */
export function removeAttachmentRef(text: string, ref: string): string {
  const idx = text.lastIndexOf(ref)
  if (idx < 0) return text
  let end = idx + ref.length
  if (text[end] === ' ') end += 1
  else if (idx > 0 && text[idx - 1] === ' ' && (end === text.length || text[end] === '\n')) {
    return text.slice(0, idx - 1) + text.slice(end)
  }
  return text.slice(0, idx) + text.slice(end)
}
