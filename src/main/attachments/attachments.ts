/** Вложения промпта: файлы складываются в `<project>/.pi/attachments/` и упоминаются в тексте
 *  как `@.pi/attachments/<name>`; картинки дополнительно уходят в `prompt.images` base64-блоками.
 *  Порт `Attachments.kt` + `ChatPanel` attach/paste. */
import { promises as fs } from 'node:fs'
import { win32 } from 'node:path'
import { dialog } from 'electron'
import type { PiJsonObject } from '../../shared/protocol-types'
import { attachmentRef, imageMimeTypeForExtension, sanitizeAttachmentName } from '../../shared/attachments'
import type { AttachmentResult, ProjectEntry } from '../../shared/ipc-contracts'

const GITIGNORE_ENTRY = '.pi/attachments/'

function attachmentsDir(project: ProjectEntry): string {
  return win32.join(project.dir, '.pi', 'attachments')
}

function result(name: string): AttachmentResult {
  return {
    ok: true,
    error: null,
    name,
    isImage: imageMimeTypeForExtension(win32.extname(name).slice(1)) !== null,
    ref: attachmentRef(name)
  }
}

/** Свободное имя: `name.ext` → `name-1.ext`, `name-2.ext`, … */
async function nextName(dir: string, suggested: string): Promise<string> {
  const base = sanitizeAttachmentName(suggested)
  const ext = win32.extname(base)
  const stem = ext.length > 0 ? base.slice(0, -ext.length) : base
  let candidate = base
  for (let i = 1; i < 1000; i++) {
    try {
      await fs.access(win32.join(dir, candidate))
    } catch {
      return candidate
    }
    candidate = `${stem}-${i}${ext}`
  }
  return `${stem}-${Date.now()}${ext}`
}

async function ensureGitignore(project: ProjectEntry): Promise<void> {
  const path = win32.join(project.dir, '.gitignore')
  let current = ''
  try {
    current = await fs.readFile(path, 'utf8')
  } catch {
    current = ''
  }
  if (current.split(/\r?\n/).some((line) => line.trim() === GITIGNORE_ENTRY)) return
  const prefix = current.length > 0 && !current.endsWith('\n') ? '\n' : ''
  await fs.writeFile(path, `${current}${prefix}${GITIGNORE_ENTRY}\n`, 'utf8')
}

/** Сохранить вложение из renderer (paste картинки — base64). */
export async function putAttachment(project: ProjectEntry, suggestedName: string, base64: string): Promise<AttachmentResult> {
  try {
    const dir = attachmentsDir(project)
    await fs.mkdir(dir, { recursive: true })
    const name = await nextName(dir, suggestedName)
    await fs.writeFile(win32.join(dir, name), Buffer.from(base64, 'base64'))
    await ensureGitignore(project)
    return result(name)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), name: '', isImage: false, ref: '' }
  }
}

/** Выбрать файл диалогом и скопировать во вложения. */
export async function chooseAttachment(project: ProjectEntry): Promise<AttachmentResult> {
  const picked = await dialog.showOpenDialog({
    properties: ['openFile'],
    defaultPath: project.dir
  })
  if (picked.canceled || picked.filePaths.length === 0) {
    return { ok: false, error: 'cancelled', name: '', isImage: false, ref: '' }
  }
  const src = picked.filePaths[0]
  try {
    const dir = attachmentsDir(project)
    await fs.mkdir(dir, { recursive: true })
    const name = await nextName(dir, win32.basename(src))
    await fs.copyFile(src, win32.join(dir, name))
    await ensureGitignore(project)
    return result(name)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), name: '', isImage: false, ref: '' }
  }
}

/** Картинки для `prompt.images`: имена уже sanitized, нечитаемые пропускаются. */
export async function readAttachmentImages(project: ProjectEntry, names: string[]): Promise<PiJsonObject[]> {
  const blocks: PiJsonObject[] = []
  for (const name of names) {
    if (!/^[A-Za-z0-9._-]+$/.test(name)) continue
    const mimeType = imageMimeTypeForExtension(win32.extname(name).slice(1))
    if (mimeType === null) continue
    try {
      const data = await fs.readFile(win32.join(attachmentsDir(project), name))
      blocks.push({ type: 'image', data: data.toString('base64'), mimeType })
    } catch {
      // Файл пропал — остаётся ссылка в тексте.
    }
  }
  return blocks
}
