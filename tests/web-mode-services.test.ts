/** Веб-режим 3/4: файловый кодек секретов (AES-256-GCM), обзор папок хоста (fs:list-dir),
 *  импорт/экспорт тем канбана строкой (без диалогов), загрузка звуков в userData, гейты
 *  апдейтера в node-хосте (electron undefined). */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFileSecretCodec } from '../src/main/secrets/file-codec'
import { hostBrowseRoot, listHostDir, parentOf } from '../src/main/files/host-dirs'
import { KanbanThemeService } from '../src/main/kanban/kanban-theme-service'
import { saveSoundFile } from '../src/main/sounds/sounds'
import { KANBAN_BUILTIN_THEMES } from '../src/shared/kanban-theme'

const updater = vi.hoisted(() => ({ app: undefined as unknown }))

vi.mock('electron', () => ({ app: updater.app }))

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'piwright-webmode-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('file secret codec (headless)', () => {
  it('roundtrips a secret and uses a fresh iv per encryption', () => {
    const codec = createFileSecretCodec(join(root, 'secrets.key'))
    const first = codec.encrypt('telegram-token-abc').toString('utf8')
    const second = codec.encrypt('telegram-token-abc').toString('utf8')
    expect(first.startsWith('enc1:')).toBe(true)
    expect(second.startsWith('enc1:')).toBe(true)
    expect(first).not.toBe(second)
    expect(codec.decrypt(Buffer.from(first, 'utf8'))).toBe('telegram-token-abc')
    expect(codec.decrypt(Buffer.from(second, 'utf8'))).toBe('telegram-token-abc')
  })

  it('decrypts the b64 fallback format and rejects safeStorage blobs', () => {
    const codec = createFileSecretCodec(join(root, 'secrets.key'))
    const legacy = Buffer.from(`b64:${Buffer.from('old-secret', 'utf8').toString('base64')}`, 'utf8')
    expect(codec.decrypt(legacy)).toBe('old-secret')
    expect(() => codec.decrypt(Buffer.from('DPAPI-raw-blob', 'utf8'))).toThrow(/safeStorage/)
  })

  it('persists the key file and fails to decrypt with a different key', () => {
    const keyFile = join(root, 'nested', 'secrets.key')
    const codec = createFileSecretCodec(keyFile)
    const blob = codec.encrypt('value').toString('utf8')
    const other = createFileSecretCodec(join(root, 'other.key'))
    expect(() => other.decrypt(Buffer.from(blob, 'utf8'))).toThrow()
    // Повторное создание с тем же файлом ключа — расшифровка работает.
    const reopened = createFileSecretCodec(keyFile)
    expect(reopened.decrypt(Buffer.from(blob, 'utf8'))).toBe('value')
  })

  it('creates the key file with restrictive permissions on posix', async () => {
    const keyFile = join(root, 'secrets.key')
    createFileSecretCodec(keyFile)
    if (process.platform !== 'win32') {
      const stat = await fs.stat(keyFile)
      expect(stat.mode & 0o077).toBe(0)
    }
  })
})

describe('host dir listing (fs:list-dir)', () => {
  it('lists only directories, sorted, with parent link', async () => {
    mkdirSync(join(root, 'b-dir'))
    mkdirSync(join(root, 'a-dir'))
    mkdirSync(join(root, 'nested', 'deep'), { recursive: true })
    writeFileSync(join(root, 'file.txt'), 'x')
    const result = await listHostDir(root)
    expect(result.ok).toBe(true)
    expect(result.dirs).toEqual(['a-dir', 'b-dir', 'nested'])
    expect(result.parent).toBe(parentOf(root))
    expect(result.path).toBe(root)
  })

  it('reports null parent at the filesystem root and rejects relative paths', async () => {
    expect(parentOf('/')).toBeNull()
    const relative = await listHostDir('some/relative/path')
    expect(relative.ok).toBe(false)
    expect(relative.error).toMatch(/absolute/i)
    const missing = await listHostDir(join(root, 'nope'))
    expect(missing.ok).toBe(false)
    expect(missing.error).not.toBeNull()
  })

  it('starts browsing from the user home directory', () => {
    expect(hostBrowseRoot()).toBe(homedir())
  })
})

describe('kanban theme import/export without dialogs', () => {
  const service = (): KanbanThemeService => new KanbanThemeService(join(root, 'kanban-themes.json'))

  it('imports a theme from a json string and merges by id', () => {
    const svc = service()
    const json = JSON.stringify({
      id: 'neon',
      name: 'Neon',
      accents: ['#ff00aa', '#00ffcc'],
      columnTint: 'rgba(255,0,170,0.12)',
      columnBorder: 'rgba(255,0,170,0.32)',
      cardTint: 'rgba(255,0,170,0.08)',
      cardBorder: 'rgba(255,0,170,0.26)',
      badge: '#ff66cc'
    })
    const first = svc.importFromJson(json)
    expect(first.ok).toBe(true)
    expect(first.imported).toBe(1)
    expect(first.skipped).toBe(0)
    const second = svc.importFromJson(json)
    expect(second.ok).toBe(true)
    expect(second.imported).toBe(0)
    expect(second.skipped).toBe(1)
  })

  it('rejects invalid json and builtin ids', () => {
    const svc = service()
    expect(svc.importFromJson('{ broken').ok).toBe(false)
    const builtin = svc.importFromJson(JSON.stringify(KANBAN_BUILTIN_THEMES[0]))
    expect(builtin.ok).toBe(false)
    expect(builtin.error).toBe('No valid themes in file')
  })

  it('exports a custom theme and a builtin theme as { name, json }', () => {
    const svc = service()
    svc.importFromJson(
      JSON.stringify({
        id: 'neon',
        name: 'Neon',
        accents: ['#ff00aa', '#00ffcc'],
        columnTint: 'rgba(255,0,170,0.12)',
        columnBorder: 'rgba(255,0,170,0.32)',
        cardTint: 'rgba(255,0,170,0.08)',
        cardBorder: 'rgba(255,0,170,0.26)',
        badge: '#ff66cc'
      })
    )
    const custom = svc.exportToJson('neon')
    expect(custom.ok).toBe(true)
    expect(custom.name).toBe('neon.json')
    expect(JSON.parse(custom.json)).toEqual({ version: 1, themes: [expect.objectContaining({ id: 'neon' })] })
    const builtin = svc.exportToJson(KANBAN_BUILTIN_THEMES[0].id)
    expect(builtin.ok).toBe(true)
    expect(JSON.parse(builtin.json)).toEqual({ version: 1, themes: [expect.objectContaining({ id: KANBAN_BUILTIN_THEMES[0].id })] })
    expect(svc.exportToJson('missing').ok).toBe(false)
  })
})

describe('sound upload (web mode)', () => {
  it('saves a wav into the target dir and sanitizes the name', async () => {
    const targetDir = join(root, 'sounds')
    const wav = Buffer.alloc(44, 1)
    const result = await saveSoundFile('../evil/мой звук.wav', wav.toString('base64'), targetDir)
    expect(result.ok).toBe(true)
    expect(result.path).toBe(join(targetDir, 'мой_звук.wav'))
    const stat = await fs.stat(result.path)
    expect(stat.size).toBe(44)
  })

  it('rejects non-audio extensions, empty payloads and oversize files', async () => {
    const targetDir = join(root, 'sounds')
    expect((await saveSoundFile('tone.mp3', Buffer.alloc(8).toString('base64'), targetDir)).ok).toBe(false)
    expect((await saveSoundFile('tone.wav', '', targetDir)).ok).toBe(false)
    const big = Buffer.alloc(3 * 1024 * 1024)
    expect((await saveSoundFile('big.wav', big.toString('base64'), targetDir)).ok).toBe(false)
  })
})

describe('updater guards in node host (electron undefined)', () => {
  it('download/install/emit are no-ops without electron app', async () => {
    updater.app = undefined
    const mod = await import('../src/main/updater')
    expect(mod.getUpdateStatus()).toEqual({ availableVersion: null, phase: 'idle' })
    expect(mod.downloadUpdate()).toEqual({ availableVersion: null, phase: 'idle' })
    expect(mod.installUpdate()).toEqual({ availableVersion: null, phase: 'idle' })
    expect(mod.emitDevUpdate('1.2.3', { get: () => ({ dismissedUpdateVersion: null }) } as never)).toEqual({
      availableVersion: null,
      phase: 'idle'
    })
  })
})
