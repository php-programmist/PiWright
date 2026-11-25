/** Тесты updater: авто-загрузка выключена, suppressed-версия не показывается,
 *  dismiss пишется в настройки, downloadUpdate — только при наличии версии. */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

type Handler = (info: { version?: string }) => void

const state = { packaged: true }
const handlers = new Map<string, Handler>()
const autoUpdaterMock = vi.hoisted(() => ({
  setFeedURL: vi.fn(),
  logger: null as unknown,
  autoDownload: true,
  autoInstallOnAppQuit: true,
  on: vi.fn(),
  checkForUpdates: vi.fn(async () => ({})),
  downloadUpdate: vi.fn(async () => ({})),
  quitAndInstall: vi.fn()
}))
autoUpdaterMock.on.mockImplementation((event: string, cb: Handler) => {
  handlers.set(event, cb)
})

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return state.packaged
    }
  }
}))
vi.mock('electron-updater', () => ({ autoUpdater: autoUpdaterMock }))

import { DEFAULT_SETTINGS, SettingsService } from '../src/main/settings/settings'
import { startAutoUpdater, getUpdateStatus, downloadUpdate, dismissUpdate, emitDevUpdate } from '../src/main/updater'
import type { UpdateStatus } from '../src/shared/ipc-contracts'

async function tempSettings(dismissed: string | null): Promise<SettingsService> {
  const dir = await fs.mkdtemp(join(tmpdir(), 'piwright-updater-'))
  const file = join(dir, 'settings.json')
  await fs.writeFile(file, JSON.stringify({ ...DEFAULT_SETTINGS, dismissedUpdateVersion: dismissed }), 'utf8')
  return new SettingsService(file)
}

function emit(event: string, info: { version?: string } = {}): void {
  handlers.get(event)?.(info)
}

let events: UpdateStatus[] = []

beforeEach(() => {
  handlers.clear()
  autoUpdaterMock.autoDownload = true
  autoUpdaterMock.autoInstallOnAppQuit = true
  autoUpdaterMock.downloadUpdate.mockClear()
  autoUpdaterMock.quitAndInstall.mockClear()
  events = []
})

describe('updater', () => {
  it('disables auto-download and auto-install, starts check', async () => {
    const settings = await tempSettings(null)
    startAutoUpdater(() => 'https://example.com/', settings, (s) => events.push(s))
    expect(autoUpdaterMock.autoDownload).toBe(false)
    expect(autoUpdaterMock.autoInstallOnAppQuit).toBe(false)
    expect(autoUpdaterMock.checkForUpdates).toHaveBeenCalled()
    expect(getUpdateStatus()).toEqual({ availableVersion: null, phase: 'idle' })
  })

  it('update-available pushes version; update-not-available resets it', async () => {
    const settings = await tempSettings(null)
    startAutoUpdater(() => 'https://example.com/', settings, (s) => events.push(s))
    emit('update-available', { version: '0.5.0' })
    expect(getUpdateStatus()).toEqual({ availableVersion: '0.5.0', phase: 'idle' })
    expect(events).toEqual([{ availableVersion: '0.5.0', phase: 'idle' }])
    emit('update-not-available')
    expect(getUpdateStatus()).toEqual({ availableVersion: null, phase: 'idle' })
  })

  it('dismissed version is not shown, a newer one is', async () => {
    const settings = await tempSettings('0.5.0')
    startAutoUpdater(() => 'https://example.com/', settings, (s) => events.push(s))
    emit('update-available', { version: '0.5.0' })
    expect(getUpdateStatus().availableVersion).toBeNull()
    emit('update-available', { version: '0.6.0' })
    expect(getUpdateStatus()).toEqual({ availableVersion: '0.6.0', phase: 'idle' })
  })

  it('dismissUpdate persists the version and hides the banner', async () => {
    const settings = await tempSettings(null)
    startAutoUpdater(() => 'https://example.com/', settings, (s) => events.push(s))
    emit('update-available', { version: '0.5.0' })
    expect(dismissUpdate(settings)).toEqual({ availableVersion: null, phase: 'idle' })
    expect(settings.get().dismissedUpdateVersion).toBe('0.5.0')
    const reread = new SettingsService(settings.path)
    expect(reread.get().dismissedUpdateVersion).toBe('0.5.0')
    emit('update-available', { version: '0.5.0' })
    expect(getUpdateStatus().availableVersion).toBeNull()
  })

  it('downloadUpdate starts download only when a version is available and idle', async () => {
    const settings = await tempSettings(null)
    startAutoUpdater(() => 'https://example.com/', settings, (s) => events.push(s))
    expect(downloadUpdate()).toEqual({ availableVersion: null, phase: 'idle' })
    expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled()
    emit('update-available', { version: '0.5.0' })
    expect(downloadUpdate()).toEqual({ availableVersion: '0.5.0', phase: 'downloading' })
    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalled()
    expect(downloadUpdate()).toEqual({ availableVersion: '0.5.0', phase: 'downloading' })
    expect(autoUpdaterMock.downloadUpdate).toHaveBeenCalledTimes(1)
  })

  it('downloadUpdate is a no-op in dev (no feed configured)', async () => {
    const settings = await tempSettings(null)
    startAutoUpdater(() => 'https://example.com/', settings, (s) => events.push(s))
    emit('update-available', { version: '0.5.0' })
    state.packaged = false
    try {
      expect(downloadUpdate()).toEqual({ availableVersion: '0.5.0', phase: 'idle' })
      expect(autoUpdaterMock.downloadUpdate).not.toHaveBeenCalled()
    } finally {
      state.packaged = true
    }
  })

  it('download error re-enables the offer, downloaded triggers quitAndInstall', async () => {
    const settings = await tempSettings(null)
    startAutoUpdater(() => 'https://example.com/', settings, (s) => events.push(s))
    emit('update-available', { version: '0.5.0' })
    downloadUpdate()
    emit('error')
    expect(getUpdateStatus()).toEqual({ availableVersion: '0.5.0', phase: 'error' })
    downloadUpdate()
    emit('update-downloaded')
    expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalled()
  })

  it('emitDevUpdate is a no-op in a packaged app and works in dev', async () => {
    const settings = await tempSettings(null)
    startAutoUpdater(() => 'https://example.com/', settings, (s) => events.push(s))
    emit('update-not-available')
    expect(emitDevUpdate('9.9.9', settings)).toEqual({ availableVersion: null, phase: 'idle' })
    state.packaged = false
    try {
      expect(emitDevUpdate('9.9.9', settings)).toEqual({ availableVersion: '9.9.9', phase: 'idle' })
      expect(emitDevUpdate(null, settings)).toEqual({ availableVersion: null, phase: 'idle' })
    } finally {
      state.packaged = true
    }
  })
})
