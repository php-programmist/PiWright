import { describe, expect, it } from 'vitest'
import {
  MAX_IMAGE_BASE64_CHARS,
  MAX_PROMPT_IMAGES,
  addressRank,
  attachedFrame,
  catalogFrame,
  catalogModelOf,
  decodeCatalogModels,
  decodeCatalogThinkingLevels,
  errorFrame,
  isVirtualAdapterName,
  normalizeCreateSessionRequest,
  normalizePromptImages,
  normalizeSessionName,
  parseFrame,
  pickLanAddress,
  remoteRequestId,
  remoteTodos,
  resolveCreateProject,
  sessionCreatedFrame,
  sessionListFrame,
  snapshotFrame,
  stripRemoteRequestId,
  todosFrame,
  uiAnsweredFrame
} from '../src/main/remote/protocol'
import { RemoteAuth, generatePin, normalizePin } from '../src/main/remote/auth'
import { wsAcceptKey } from '../src/main/remote/ws'

describe('remote ids', () => {
  it('prefix + seq + client id, stripped back only for the owner socket', () => {
    expect(remoteRequestId(3, 'abc')).toBe('web-3-abc')
    expect(remoteRequestId(3, null)).toBe('web-3-auto')
    expect(stripRemoteRequestId(3, 'web-3-abc')).toBe('abc')
    expect(stripRemoteRequestId(4, 'web-3-abc')).toBeNull()
    expect(stripRemoteRequestId(3, 'web-31-abc')).toBeNull()
  })
})

describe('parseFrame', () => {
  it('objects only', () => {
    expect(parseFrame('{"type":"ping"}')).toEqual({ type: 'ping' })
    expect(parseFrame('[1]')).toBeNull()
    expect(parseFrame('nope')).toBeNull()
    expect(parseFrame('null')).toBeNull()
  })
})

describe('create session request', () => {
  it('defaults and truncation', () => {
    expect(normalizeCreateSessionRequest({}, 'New Chat')).toEqual({ name: 'New Chat', model: null, thinking: null, project: null })
    expect(normalizeCreateSessionRequest({ name: '  ' }, 'New Chat').name).toBe('New Chat')
    expect(normalizeCreateSessionRequest({ name: 'x'.repeat(150) }, 'New Chat').name).toHaveLength(100)
    expect(normalizeCreateSessionRequest({ name: 'api', model: 'a/b', thinking: 'high', project: 'p' }, 'New Chat')).toEqual({
      name: 'api',
      model: 'a/b',
      thinking: 'high',
      project: 'p'
    })
  })

  it('session name normalization', () => {
    expect(normalizeSessionName('  new name ')).toBe('new name')
    expect(normalizeSessionName('   ')).toBeNull()
    expect(normalizeSessionName(5)).toBeNull()
  })

  it('project resolution: explicit wins, single candidate auto', () => {
    expect(resolveCreateProject('p', ['a', 'b'])).toBe('p')
    expect(resolveCreateProject(null, ['a'])).toBe('a')
    expect(resolveCreateProject(null, ['a', 'b'])).toBeNull()
  })
})

describe('prompt images validation', () => {
  it('accepts valid blocks', () => {
    const res = normalizePromptImages([{ data: 'aaa', mimeType: 'image/png' }])
    expect(res.error).toBeNull()
    expect(res.blocks).toEqual([{ type: 'image', data: 'aaa', mimeType: 'image/png' }])
  })

  it('rejects wrong shapes', () => {
    expect(normalizePromptImages('x').error).toBe('images must be an array')
    expect(normalizePromptImages([{ data: '', mimeType: 'image/png' }]).error).toBe('image data is missing')
    expect(normalizePromptImages([{ data: 'a' }]).error).toBe('image mimeType is missing')
    expect(normalizePromptImages([1]).error).toBe('image must be an object')
    expect(
      normalizePromptImages(Array.from({ length: MAX_PROMPT_IMAGES + 1 }, () => ({ data: 'a', mimeType: 'image/png' }))).error
    ).toContain('too many')
    expect(normalizePromptImages([{ data: 'x'.repeat(MAX_IMAGE_BASE64_CHARS + 1), mimeType: 'image/png' }]).error).toBe(
      'image is too large'
    )
    expect(normalizePromptImages(null).error).toBeNull()
  })
})

describe('lan address picking', () => {
  it('virtual adapters are filtered, rank prefers 192.168', () => {
    expect(isVirtualAdapterName('vEthernet (WSL)')).toBe(true)
    expect(isVirtualAdapterName('Ethernet')).toBe(false)
    expect(addressRank('192.168.1.5')).toBe(0)
    expect(addressRank('10.1.2.3')).toBe(1)
    expect(addressRank('172.20.1.2')).toBe(2)
    expect(addressRank('8.8.8.8')).toBe(3)
    expect(
      pickLanAddress([
        ['vEthernet (WSL)', '172.20.1.2'],
        ['Ethernet', '192.168.1.5'],
        ['Wi-Fi', '10.0.0.2']
      ])
    ).toBe('192.168.1.5')
    expect(pickLanAddress([['vEthernet (WSL)', '172.20.1.2']])).toBe('172.20.1.2')
    expect(pickLanAddress([])).toBeNull()
  })
})

describe('frames', () => {
  it('sessions list carries all fields', () => {
    const frame = sessionListFrame([{ id: '1', title: 't', project: 'p', status: 'busy', telegram: true, unread: false }])
    expect(frame).toEqual({
      type: 'sessions',
      sessions: [{ id: '1', title: 't', project: 'p', status: 'busy', telegram: true, unread: false }]
    })
  })

  it('error / attached / ui_answered / created / snapshot', () => {
    expect(errorFrame('x')).toEqual({ type: 'error', message: 'x' })
    expect(attachedFrame('1', 't', 'p', false, true)).toEqual({ type: 'attached', id: '1', title: 't', project: 'p', telegram: false, loops: true })
    expect(uiAnsweredFrame('1', 'phone')).toEqual({ type: 'ui_answered', id: '1', by: 'phone' })
    expect(sessionCreatedFrame('9')).toEqual({ type: 'session_created', id: '9' })
    expect(snapshotFrame([{ a: 1 }, { b: 2 }, { c: 3 }, { d: 4 }])).toEqual({
      type: 'snapshot',
      streaming: false,
      messages: [{ a: 1 }, { b: 2 }, { c: 3 }, { d: 4 }]
    })
  })

  it('todos: pi-todo widget wins over plan glyphs', () => {
    const items = remoteTodos({
      'pi-agent-desktop:todo': ['{"subject":"a","status":"completed"}'],
      'plan-todos': ['☑ b']
    })
    expect(items).toEqual([{ subject: 'a', status: 'completed' }])
    expect(todosFrame(items)).toEqual({ type: 'todos', items: [{ content: 'a', status: 'completed' }] })
    expect(remoteTodos({})).toEqual([])
  })
})

describe('catalog', () => {
  it('catalog frame with defaults and request id', () => {
    const frame = catalogFrame(
      [{ key: 'a/b', name: 'B', provider: 'a', thinkingLevels: ['high'] }],
      ['high'],
      'a/b',
      'high',
      'req-1'
    )
    expect(frame['type']).toBe('catalog')
    expect(frame['id']).toBe('req-1')
    expect(frame['defaultModel']).toBe('a/b')
    const models = decodeCatalogModels({ models: [{ key: 'a/b', name: 'B', provider: 'a', thinkingLevels: ['high'] }] })
    expect(models).toEqual([{ key: 'a/b', name: 'B', provider: 'a', thinkingLevels: ['high'] }])
    expect(decodeCatalogModels(null)).toEqual([])
    expect(decodeCatalogThinkingLevels({ levels: ['low', 5] })).toEqual(['low'])
  })

  it('catalogModelOf maps PiModelInfo', () => {
    expect(catalogModelOf({ provider: 'a', id: 'b', name: 'B', contextWindow: 1, thinkingLevels: [], imageInput: false })).toEqual({
      key: 'a/b',
      name: 'B',
      provider: 'a'
    })
  })
})

describe('RemoteAuth', () => {
  it('pin normalize ignores whitespace', () => {
    expect(normalizePin(' 1 2 3 456 ')).toBe('123456')
    const auth = new RemoteAuth('123456')
    expect(auth.checkPin('123 456')).toBe(true)
    expect(auth.checkPin('000000')).toBe(false)
    expect(generatePin()).toMatch(/^\d{6}$/)
    expect(auth.groupedPin).toBe('123 456')
  })

  it('setStaticPin applies static pin, falls back to random once when cleared', () => {
    const auth = new RemoteAuth('111111')
    auth.setStaticPin('654321')
    expect(auth.pin).toBe('654321')
    expect(auth.checkPin('654321')).toBe(true)
    auth.setStaticPin('654321')
    expect(auth.pin).toBe('654321')
    auth.setStaticPin(null)
    expect(auth.pin).toMatch(/^\d{6}$/)
    expect(auth.pin).not.toBe('654321')
    const next = auth.pin
    auth.setStaticPin(null)
    expect(auth.pin).toBe(next)
  })

  it('browser sessions authorize, lockout after 5 failures', () => {
    const auth = new RemoteAuth('123456')
    const token = auth.newBrowserSession()
    expect(auth.isAuthorized(token)).toBe(true)
    expect(auth.isAuthorized('other')).toBe(false)
    for (let i = 0; i < 4; i++) expect(auth.noteFailure('peer')).toBe(false)
    expect(auth.isLocked('peer')).toBe(false)
    expect(auth.noteFailure('peer')).toBe(true)
    expect(auth.isLocked('peer')).toBe(true)
    auth.clearFailures('peer')
    expect(auth.isLocked('peer')).toBe(false)
  })
})

describe('wsAcceptKey', () => {
  it('RFC 6455 example vector', () => {
    expect(wsAcceptKey('dGhlIHNhbXBsZSBub25jZQ==')).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=')
  })
})
