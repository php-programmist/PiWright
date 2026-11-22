/** Вложения промпта: mime по расширению и безопасное имя файла. Порт `PiSession.imageMimeTypeForExtension` + `Attachments.kt`. */

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

/** Имя файла внутри `.pi/attachments/`: плоское, без разделителей пути. */
export function sanitizeAttachmentName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_').slice(0, 100)
  return cleaned.length > 0 ? cleaned : 'attachment'
}

/** Ссылка в тексте промпта — pi читает файл своим инструментом (`@file` в RPC-режиме — текстом). */
export function attachmentRef(name: string): string {
  return `@.pi/attachments/${name}`
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
