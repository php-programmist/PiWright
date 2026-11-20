import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { attachmentRef, base64FromBytes, imageMimeTypeForExtension, sanitizeAttachmentName } from '../src/shared/attachments'
import { putAttachment, readAttachmentImages } from '../src/main/attachments/attachments'
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
    expect(attachmentRef('a.png')).toBe('@.pi/attachments/a.png')
  })

  it('base64FromBytes round-trips binary', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255])
    expect(Buffer.from(base64FromBytes(bytes), 'base64')).toEqual(Buffer.from(bytes))
  })
})

describe('putAttachment', () => {
  it('writes the file, reports image flag and ref, adds gitignore entry', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    const res = await putAttachment(project(), 'Screenshot1.png', png.toString('base64'))
    expect(res.ok).toBe(true)
    expect(res.name).toBe('Screenshot1.png')
    expect(res.isImage).toBe(true)
    expect(res.ref).toBe('@.pi/attachments/Screenshot1.png')
    const saved = await fs.readFile(join(projectDir, '.pi', 'attachments', 'Screenshot1.png'))
    expect(saved).toEqual(png)
    const gitignore = await fs.readFile(join(projectDir, '.gitignore'), 'utf8')
    expect(gitignore).toContain('.pi/attachments/')
  })

  it('sanitizes the name and suffixes collisions', async () => {
    const first = await putAttachment(project(), 'my shot.png', 'aGk=')
    const second = await putAttachment(project(), 'my shot.png', 'aGk=')
    expect(first.name).toBe('my_shot.png')
    expect(second.name).toBe('my_shot-1.png')
  })

  it('non-image files are not flagged as images', async () => {
    const res = await putAttachment(project(), 'notes.txt', 'aGk=')
    expect(res.isImage).toBe(false)
  })
})

describe('readAttachmentImages', () => {
  it('reads only images by extension, skips missing and unsafe names', async () => {
    await putAttachment(project(), 'pic.png', Buffer.from([1, 2, 3]).toString('base64'))
    await putAttachment(project(), 'note.txt', 'aGk=')
    const blocks = await readAttachmentImages(project(), ['pic.png', 'note.txt', 'gone.png', '../escape.png'])
    expect(blocks).toEqual([{ type: 'image', data: Buffer.from([1, 2, 3]).toString('base64'), mimeType: 'image/png' }])
  })
})
