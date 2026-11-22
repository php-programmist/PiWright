import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, mergeNotifications } from '../src/main/settings/settings'
import { NotificationHub } from '../src/main/notifications/hub'
import { telegramMessage } from '../src/main/notifications/telegram'
import { TelegramTokenStore } from '../src/main/notifications/token-store'
import type { RemoteBridge } from '../src/main/remote/bridge'
import type { PiEventMessage } from '../src/shared/ipc-contracts'

describe('mergeNotifications', () => {
  it('defaults when value is garbage', () => {
    expect(mergeNotifications(null)).toEqual(DEFAULT_SETTINGS.notifications)
    expect(mergeNotifications('x')).toEqual(DEFAULT_SETTINGS.notifications)
    expect(mergeNotifications([])).toEqual(DEFAULT_SETTINGS.notifications)
  })

  it('overrides known fields only, clamps port', () => {
    const merged = mergeNotifications({
      sounds: { completion: 'C:\\x.wav', await: 5 },
      telegram: { chatId: '42', events: { turnEnd: false, permission: 'yes' } },
      remote: { enabled: true, port: 99999 }
    })
    expect(merged.sounds.completion).toBe('C:\\x.wav')
    expect(merged.sounds.await).toBe(DEFAULT_SETTINGS.notifications.sounds.await)
    expect(merged.sounds.error).toBe(DEFAULT_SETTINGS.notifications.sounds.error)
    expect(merged.telegram).toEqual({ chatId: '42', events: { turnEnd: false, permission: true, question: true, error: true } })
    expect(merged.remote).toEqual({ enabled: true, port: 65535 })
  })

  it('settings file with partial notifications merges over defaults', () => {
    const merged = mergeNotifications({ remote: { enabled: true } })
    expect(merged.remote.enabled).toBe(true)
    expect(merged.remote.port).toBe(7690)
  })
})

describe('telegramMessage', () => {
  it('project · title: kind text', () => {
    expect(telegramMessage('api', 'fix auth', 'turnEnd')).toBe('api · fix auth: ход завершён')
    expect(telegramMessage('api', 'fix auth', 'permission')).toBe('api · fix auth: просит разрешение на команду')
    expect(telegramMessage('api', 'fix auth', 'question')).toBe('api · fix auth: нужен ответ')
    expect(telegramMessage('api', 'fix auth', 'error')).toBe('api · fix auth: ошибка расширения')
  })
})

describe('TelegramTokenStore', () => {
  it('round-trips through encrypt/decrypt and blanks remove the token', () => {
    const store = new TelegramTokenStore(
      'C:\\tmp',
      (value) => Buffer.from(`enc:${value}`, 'utf8'),
      (buffer) => buffer.toString('utf8').slice(4)
    )
    store.write('123:ABC')
    expect(store.read()).toBe('123:ABC')
    store.write('')
    expect(store.read()).toBeNull()
  })

  it('unreadable file reads as null', () => {
    const store = new TelegramTokenStore(
      'C:\\tmp',
      () => Buffer.from('x'),
      () => {
        throw new Error('boom')
      }
    )
    store.write('t')
    expect(store.read()).toBeNull()
  })
})

describe('NotificationHub', () => {
  const settings = (): typeof DEFAULT_SETTINGS => JSON.parse(JSON.stringify(DEFAULT_SETTINGS))
  let sent: { chatId: string; text: string }[] = []
  let tokenDir = ''

  beforeEach(async () => {
    sent = []
    tokenDir = await fs.mkdtemp(join(tmpdir(), 'piwright-hub-'))
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: { body?: string }) => {
        const body = JSON.parse(init?.body ?? '{}') as { chat_id: string; text: string }
        sent.push({ chatId: body.chat_id, text: body.text })
        return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response
      })
    )
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    await fs.rm(tokenDir, { recursive: true, force: true })
  })

  function hub(
    overrides: Partial<typeof DEFAULT_SETTINGS.notifications.telegram> = {},
    bridge: RemoteBridge | null = null,
    hostTelegramEnabled = true
  ): NotificationHub {
    const s = settings()
    s.notifications.telegram = { ...s.notifications.telegram, ...overrides }
    const store = new TelegramTokenStore(
      tokenDir,
      (value) => Buffer.from(value, 'utf8'),
      (buffer) => buffer.toString('utf8')
    )
    store.write('tok')
    return new NotificationHub(
      () => s,
      store,
      {
        get: (hostId: string) =>
          hostId === 'h1'
            ? {
                telegramEnabled: hostTelegramEnabled,
                lastStatus: () => ({ project: { kind: 'native', dir: 'D:\\Work\\api' }, title: 'fix auth' })
              }
            : null
      } as never,
      () => bridge
    )
  }

  const event = (event: PiEventMessage['event']): PiEventMessage => ({ hostId: 'h1', event })

  it('turn_end sends turnEnd notification with project basename', () => {
    hub({ chatId: '42' }).onEvent(event({ type: 'turn_end' }))
    expect(sent).toEqual([{ chatId: '42', text: 'api · fix auth: ход завершён' }])
  })

  it('empty chat id suppresses sending', () => {
    hub().onEvent(event({ type: 'turn_end' }))
    expect(sent).toEqual([])
  })

  it('check turn_end (loop check prompt) suppresses sending', () => {
    hub({ chatId: '42' }).onEvent(event({ type: 'turn_end', check: true }))
    expect(sent).toEqual([])
  })

  it('confirm dialog sends permission, other dialogs send question', () => {
    const h = hub({ chatId: '42' })
    h.onEvent(event({ type: 'dialog_open', id: '1', dialog: { kind: 'confirm', title: 'run?', message: null, timeoutMs: null } }))
    h.onEvent(event({ type: 'dialog_open', id: '2', dialog: { kind: 'input', title: 'q', placeholder: null, timeoutMs: null } }))
    expect(sent.map((s) => s.text)).toEqual(['api · fix auth: просит разрешение на команду', 'api · fix auth: нужен ответ'])
  })

  it('event checkbox off suppresses sending', () => {
    hub({ events: { turnEnd: false, permission: true, question: true, error: true } }).onEvent(event({ type: 'turn_end' }))
    expect(sent).toEqual([])
  })

  it('phone visible or session telegram off suppresses sending', () => {
    hub({}, { isPhoneVisible: () => true } as unknown as RemoteBridge).onEvent(event({ type: 'turn_end' }))
    hub({}, null, false).onEvent(event({ type: 'turn_end' }))
    expect(sent).toEqual([])
  })

  it('missing token suppresses sending', () => {
    const s = settings()
    const h = new NotificationHub(
      () => s,
      new TelegramTokenStore('C:\\tmp', () => Buffer.from(''), () => ''),
      { get: () => null } as never,
      () => null
    )
    h.onEvent(event({ type: 'turn_end' }))
    expect(sent).toEqual([])
  })

  it('notify isError sends error kind, non-error notify does not', () => {
    const h = hub({ chatId: '42' })
    h.onEvent(event({ type: 'notify', message: 'boom', isError: true }))
    h.onEvent(event({ type: 'notify', message: 'info', isError: false }))
    expect(sent).toEqual([{ chatId: '42', text: 'api · fix auth: ошибка расширения' }])
  })
})
