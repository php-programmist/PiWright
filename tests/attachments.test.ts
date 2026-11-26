import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { attachmentRef, base64FromBytes, imageMimeTypeForExtension, isImageFilePath, removeAttachmentRef, sanitizeAttachmentName, splitAttachmentRefs } from '../src/shared/attachments'
import { putAttachment, readAttachmentImages } from '../src/main/attachments/attachments'

const SETTINGS = { ...DEFAULT_SETTINGS }
import { DEFAULT_SETTINGS } from '../src/main/settings/settings'
import type { ProjectEntry } from '../src/shared/ipc-contracts'

vi.mock('electron', () => ({ dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) } }))

let projectDir = ''
const project = (): ProjectEntry => ({ kind: 'native', dir: projectDir })

beforeEach(async () => {
  projectDir = join(tmpdir(), `piwright-att-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  await fs.mkdir(projectDir, { recursive: true })
})

describe('shared attachments helpers', () => {
  it('mime type by extension', () => {
    expect(imageMimeTypeForExtension('png')).toBe('image/png')
    expect(imageMimeTypeForExtension('JPG')).toBe('image/jpeg')
    expect(imageMimeTypeForExtension('webp')).toBe('image/webp')
    expect(imageMimeTypeForExtension('txt')).toBeNull()
  })

  it('names are flat and safe', () => {
    expect(sanitizeAttachmentName('../evil.png')).toBe('__evil.png')
    expect(sanitizeAttachmentName('my shot (1).png')).toBe('my_shot__1_.png')
    expect(sanitizeAttachmentName('')).toBe('attachment')
    expect(attachmentRef(projectDir, 'a.png')).toBe('@.pi/attachments/a.png')
  })

  it('cyrillic names are preserved', () => {
    expect(sanitizeAttachmentName('Расписания занятий.jpg')).toBe('Расписания_занятий.jpg')
    expect(sanitizeAttachmentName('Расписания занятий.jpg')).not.toContain('_'.repeat(3))
    expect(attachmentRef(projectDir, 'Расписания_занятий.jpg')).toBe('@.pi/attachments/Расписания_занятий.jpg')
    expect(splitAttachmentRefs('смотри @.pi/attachments/Расписания_занятий.jpg тут')).toEqual([
      { kind: 'text', text: 'смотри ' },
      { kind: 'ref', ref: '@.pi/attachments/Расписания_занятий.jpg', name: 'Расписания_занятий.jpg' },
      { kind: 'text', text: ' тут' }
    ])
  })

  it('ref from a worktree session points to the repo root', () => {
    const wtDir = join(projectDir, '.pi', 'worktrees', 'demo')
    expect(attachmentRef(wtDir, 'a.png')).toBe('@../../.pi/attachments/a.png')
  })

  it('splitAttachmentRefs splits text into text and ref segments', () => {
    expect(splitAttachmentRefs('no refs')).toEqual([{ kind: 'text', text: 'no refs' }])
    expect(splitAttachmentRefs('look @.pi/attachments/a.png here')).toEqual([
      { kind: 'text', text: 'look ' },
      { kind: 'ref', ref: '@.pi/attachments/a.png', name: 'a.png' },
      { kind: 'text', text: ' here' }
    ])
    expect(splitAttachmentRefs('@../../.pi/attachments/b.png')).toEqual([
      { kind: 'ref', ref: '@../../.pi/attachments/b.png', name: 'b.png' }
    ])
    expect(splitAttachmentRefs('@.pi/other/c.png')).toEqual([{ kind: 'text', text: '@.pi/other/c.png' }])
  })

  it('base64FromBytes round-trips binary', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255])
    expect(Buffer.from(base64FromBytes(bytes), 'base64')).toEqual(Buffer.from(bytes))
  })

  it('isImageFilePath by extension', () => {
    expect(isImageFilePath('a/b/shot.PNG')).toBe(true)
    expect(isImageFilePath('x.jpeg')).toBe(true)
    expect(isImageFilePath('x.bmp')).toBe(true)
    expect(isImageFilePath('x.txt')).toBe(false)
    expect(isImageFilePath('noext')).toBe(false)
  })

  it('removeAttachmentRef drops the last occurrence with one adjacent space', () => {
    const ref = attachmentRef(projectDir, 'a.png')
    expect(removeAttachmentRef(`look ${ref} at this`, ref)).toBe('look at this')
    expect(removeAttachmentRef(`${ref} only`, ref)).toBe('only')
    expect(removeAttachmentRef(`only ${ref}`, ref)).toBe('only')
    expect(removeAttachmentRef(`a ${ref}\nb ${ref} c`, ref)).toBe(`a ${ref}\nb c`)
    expect(removeAttachmentRef('no refs here', ref)).toBe('no refs here')
  })
})

describe('putAttachment', () => {
  it('writes the file, reports image flag and ref, adds gitignore entry', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    const res = await putAttachment(project(), SETTINGS, 'Screenshot1.png', png.toString('base64'))
    expect(res.ok).toBe(true)
    expect(res.name).toBe('Screenshot1.png')
    expect(res.isImage).toBe(true)
    expect(res.ref).toBe('@.pi/attachments/Screenshot1.png')
    expect(res.dataUrl).toBe(`data:image/png;base64,${png.toString('base64')}`)
    const saved = await fs.readFile(join(projectDir, '.pi', 'attachments', 'Screenshot1.png'))
    expect(saved).toEqual(png)
    const gitignore = await fs.readFile(join(projectDir, '.gitignore'), 'utf8')
    expect(gitignore).toContain('.pi/attachments/')
  })

  it('sanitizes the name and suffixes collisions', async () => {
    const first = await putAttachment(project(), SETTINGS, 'my shot.png', 'aGk=')
    const second = await putAttachment(project(), SETTINGS, 'my shot.png', 'aGk=')
    expect(first.name).toBe('my_shot.png')
    expect(second.name).toBe('my_shot-1.png')
  })

  it('non-image files are not flagged as images', async () => {
    const res = await putAttachment(project(), SETTINGS, 'notes.txt', 'aGk=')
    expect(res.isImage).toBe(false)
    expect(res.dataUrl).toBe('')
  })

  it('worktree sessions store attachments in the repo root', async () => {
    const wtDir = join(projectDir, '.pi', 'worktrees', 'demo')
    await fs.mkdir(wtDir, { recursive: true })
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    const res = await putAttachment({ kind: 'native', dir: wtDir }, SETTINGS, 'shot.png', png.toString('base64'))
    expect(res.ok).toBe(true)
    expect(res.ref).toBe('@../../.pi/attachments/shot.png')
    const saved = await fs.readFile(join(projectDir, '.pi', 'attachments', 'shot.png'))
    expect(saved).toEqual(png)
    await expect(fs.readFile(join(wtDir, '.pi', 'attachments', 'shot.png'))).rejects.toThrow()
    const gitignore = await fs.readFile(join(projectDir, '.gitignore'), 'utf8')
    expect(gitignore).toContain('.pi/attachments/')
    await expect(fs.readFile(join(wtDir, '.gitignore'), 'utf8')).rejects.toThrow()
  })
})

describe('readAttachmentImages', () => {
  it('reads only images by extension, skips missing and unsafe names', async () => {
    await putAttachment(project(), SETTINGS, 'pic.png', Buffer.from([1, 2, 3]).toString('base64'))
    await putAttachment(project(), SETTINGS, 'note.txt', 'aGk=')
    const blocks = await readAttachmentImages(project(), SETTINGS, ['pic.png', 'note.txt', 'gone.png', '../escape.png'])
    expect(blocks).toEqual([{ type: 'image', data: Buffer.from([1, 2, 3]).toString('base64'), mimeType: 'image/png' }])
  })
})
