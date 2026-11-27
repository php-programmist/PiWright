/** Вложения промпта: файлы складываются в `<project>/.pi/attachments/` и упоминаются в тексте
 *  как `@.pi/attachments/<name>`; картинки дополнительно уходят в `prompt.images` base64-блоками.
 *  Запись — через ProjectFs (ssh-проекты — SFTP на сервер). Порт `Attachments.kt` + `ChatPanel`. */
import { promises as fs } from 'node:fs'
import { dialog } from 'electron'
import type { PiJsonObject } from '../../shared/protocol-types'
import { attachmentRef, imageMimeTypeForExtension, sanitizeAttachmentName } from '../../shared/attachments'
import { splitWorktreeHostDir } from '../../shared/worktree'
import { getProjectFs, hostProjectFs, type ProjectFs } from '../fs/project-fs'
import type { AttachmentResult, ProjectEntry, Settings } from '../../shared/ipc-contracts'
import { errorMessage } from '../../shared/errors'

const GITIGNORE_ENTRY = '.pi/attachments/'

/** Корень хранилища вложений: общая папка корня репо — у worktree-сессий вложения не должны
 *  пропадать вместе с удалением worktree, поэтому пишем в `<root>/.pi/attachments/`. */
function attachmentsBaseDir(project: ProjectEntry): string {
  const wt = splitWorktreeHostDir(project.dir)
  return wt !== null ? wt.root : project.dir
}

function attachmentsDir(pfs: ProjectFs, project: ProjectEntry): string {
  return pfs.join(attachmentsBaseDir(project), '.pi', 'attachments')
}

async function result(pfs: ProjectFs, project: ProjectEntry, dir: string, name: string): Promise<AttachmentResult> {
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : ''
  const isImage = imageMimeTypeForExtension(ext) !== null
  let dataUrl = ''
  if (isImage) {
    try {
      const data = await pfs.readFile(pfs.join(dir, name))
      const mime = imageMimeTypeForExtension(ext)
      dataUrl = `data:${mime};base64,${data.toString('base64')}`
    } catch {
      // Превью не критично — чип покажет имя без миниатюры.
    }
  }
  return {
    ok: true,
    error: null,
    name,
    isImage,
    ref: attachmentRef(project.dir, name),
    dataUrl
  }
}

/** Свободное имя: `name.ext` → `name-1.ext`, `name-2.ext`, … */
async function nextName(pfs: ProjectFs, dir: string, suggested: string): Promise<string> {
  const base = sanitizeAttachmentName(suggested)
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.')) : ''
  const stem = ext.length > 0 ? base.slice(0, -ext.length) : base
  let candidate = base
  for (let i = 1; i < 1000; i++) {
    if (!(await pfs.exists(pfs.join(dir, candidate)))) return candidate
    candidate = `${stem}-${i}${ext}`
  }
  return `${stem}-${Date.now()}${ext}`
}

async function ensureGitignore(pfs: ProjectFs, project: ProjectEntry): Promise<void> {
  const path = pfs.join(attachmentsBaseDir(project), '.gitignore')
  let current = ''
  try {
    current = await pfs.readText(path)
  } catch {
    current = ''
  }
  if (current.split(/\r?\n/).some((line) => line.trim() === GITIGNORE_ENTRY)) return
  const prefix = current.length > 0 && !current.endsWith('\n') ? '\n' : ''
  await pfs.writeFile(path, `${current}${prefix}${GITIGNORE_ENTRY}\n`)
}

/** Сохранить вложение из renderer (paste картинки — base64). */
export async function putAttachment(project: ProjectEntry, settings: Settings, suggestedName: string, base64: string): Promise<AttachmentResult> {
  try {
    const pfs = getProjectFs(project, settings)
    const dir = attachmentsDir(pfs, project)
    await pfs.mkdir(dir, { recursive: true })
    const name = await nextName(pfs, dir, suggestedName)
    await pfs.writeFile(pfs.join(dir, name), Buffer.from(base64, 'base64'))
    await ensureGitignore(pfs, project)
    return await result(pfs, project, dir, name)
  } catch (err) {
    return { ok: false, error: errorMessage(err), name: '', isImage: false, ref: '', dataUrl: '' }
  }
}

/** Выбрать файл диалогом и скопировать во вложения (локальный файл → fs бэкенда проекта). */
export async function chooseAttachment(project: ProjectEntry, settings: Settings): Promise<AttachmentResult> {
  const picked = await dialog.showOpenDialog({
    properties: ['openFile'],
    defaultPath: project.kind === 'ssh' ? undefined : project.dir
  })
  if (picked.canceled || picked.filePaths.length === 0) {
    return { ok: false, error: 'cancelled', name: '', isImage: false, ref: '', dataUrl: '' }
  }
  const src = picked.filePaths[0]
  try {
    const pfs = getProjectFs(project, settings)
    const dir = attachmentsDir(pfs, project)
    await pfs.mkdir(dir, { recursive: true })
    const name = await nextName(pfs, dir, hostProjectFs.basename(src))
    const data = await fs.readFile(src)
    await pfs.writeFile(pfs.join(dir, name), data)
    await ensureGitignore(pfs, project)
    return await result(pfs, project, dir, name)
  } catch (err) {
    return { ok: false, error: errorMessage(err), name: '', isImage: false, ref: '', dataUrl: '' }
  }
}

/** Картинки для `prompt.images`: имена уже sanitized, нечитаемые пропускаются. */
export async function readAttachmentImages(project: ProjectEntry, settings: Settings, names: string[]): Promise<PiJsonObject[]> {
  const blocks: PiJsonObject[] = []
  const pfs = getProjectFs(project, settings)
  for (const name of names) {
    if (!/^[\p{L}\p{N}._-]+$/u.test(name)) continue
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : ''
    const mimeType = imageMimeTypeForExtension(ext)
    if (mimeType === null) continue
    try {
      const data = await pfs.readFile(pfs.join(attachmentsDir(pfs, project), name))
      blocks.push({ type: 'image', data: data.toString('base64'), mimeType })
    } catch {
      // Файл пропал — остаётся ссылка в тексте.
    }
  }
  return blocks
}
