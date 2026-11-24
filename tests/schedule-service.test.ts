import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ScheduleService } from '../src/main/schedule/schedule-service'
import type { PiEventMessage, ScheduledPrompt } from '../src/shared/ipc-contracts'
import type { PiHost } from '../src/main/pi/pi-host'
import type { SessionHost } from '../src/main/pi/session-host'

const project = { kind: 'native', dir: 'D:\\Work\\api' }

interface FakeHost {
  id: string
  streaming: boolean
  title: string
  prompts: { text: string; images: string[]; behavior?: string }[]
  models: string[]
  thinking: string[]
}

function fakePiHost(hosts: FakeHost[]): PiHost {
  const byId = new Map(hosts.map((h) => [h.id, h]))
  return {
    get: (hostId: string) => {
      const h = byId.get(hostId)
      if (h === undefined) return null
      return {
        id: h.id,
        streaming: h.streaming,
        project,
        lastStatus: () => ({ title: h.title }),
        setModel: (key: string) => {
          h.models.push(key)
          return Promise.resolve({ ok: true, error: null })
        },
        setThinkingLevel: (level: string) => {
          h.thinking.push(level)
          return Promise.resolve({ ok: true, error: null })
        },
        prompt: (text: string, images: string[], behavior?: string) => {
          h.prompts.push({ text, images, behavior })
          return Promise.resolve({ ok: true, error: null })
        }
      } as unknown as SessionHost
    }
  } as unknown as PiHost
}

function makeHost(id: string, streaming = false): FakeHost {
  return { id, streaming, title: `Session ${id}`, prompts: [], models: [], thinking: [] }
}

function turnEnd(hostId: string, check = false): PiEventMessage {
  return { hostId, event: { type: 'turn_end', ...(check ? { check: true } : {}) } } as PiEventMessage
}

function readItems(path: string): ScheduledPrompt[] {
  return (JSON.parse(readFileSync(path, 'utf8')) as { items: ScheduledPrompt[] }).items
}

describe('ScheduleService', () => {
  let dir: string
  let filePath: string

  beforeEach(() => {
    vi.useFakeTimers()
    dir = mkdtempSync(join(tmpdir(), 'piwright-sched-'))
    filePath = join(dir, 'scheduled-prompts.json')
  })

  afterEach(() => {
    vi.useRealTimers()
    rmSync(dir, { recursive: true, force: true })
  })

  it('fires after-item on source turn_end with fixed settings', async () => {
    const source = makeHost('src')
    const target = makeHost('tgt')
    const service = new ScheduleService(filePath, fakePiHost([source, target]), () => {})
    const result = service.schedule({
      targetHostId: 'tgt',
      text: 'continue the work',
      images: ['@a.png'],
      model: 'anthropic/claude-opus-4',
      thinkingLevel: 'high',
      trigger: { kind: 'after', sourceHostId: 'src', sourceTitle: 'Session src' }
    })
    expect(result.ok).toBe(true)
    expect(target.prompts).toHaveLength(0)

    service.onEvent(turnEnd('src'))
    await vi.advanceTimersByTimeAsync(0)
    expect(target.prompts).toEqual([{ text: 'continue the work', images: ['@a.png'], behavior: undefined }])
    expect(target.models).toEqual(['anthropic/claude-opus-4'])
    expect(target.thinking).toEqual(['high'])
    expect(service.list()).toHaveLength(0)
  })

  it('sends followUp to a busy target and skips settings', async () => {
    const source = makeHost('src')
    const target = makeHost('tgt', true)
    const service = new ScheduleService(filePath, fakePiHost([source, target]), () => {})
    service.schedule({
      targetHostId: 'tgt',
      text: 'next',
      model: 'm/x',
      thinkingLevel: 'low',
      trigger: { kind: 'after', sourceHostId: 'src', sourceTitle: 'S' }
    })
    service.onEvent(turnEnd('src'))
    await vi.advanceTimersByTimeAsync(0)
    expect(target.prompts).toEqual([{ text: 'next', images: [], behavior: 'followUp' }])
    expect(target.models).toEqual([])
    expect(target.thinking).toEqual([])
  })

  it('ignores check turn_end and unrelated hosts', async () => {
    const source = makeHost('src')
    const target = makeHost('tgt')
    const service = new ScheduleService(filePath, fakePiHost([source, target]), () => {})
    service.schedule({
      targetHostId: 'tgt',
      text: 'x',
      trigger: { kind: 'after', sourceHostId: 'src', sourceTitle: 'S' }
    })
    service.onEvent(turnEnd('src', true))
    service.onEvent(turnEnd('other'))
    await vi.advanceTimersByTimeAsync(0)
    expect(target.prompts).toHaveLength(0)
    expect(service.list()).toHaveLength(1)
  })

  it('cancel removes the item', async () => {
    const source = makeHost('src')
    const target = makeHost('tgt')
    const service = new ScheduleService(filePath, fakePiHost([source, target]), () => {})
    service.schedule({ targetHostId: 'tgt', text: 'x', trigger: { kind: 'after', sourceHostId: 'src', sourceTitle: 'S' } })
    const id = service.list()[0].id
    expect(service.cancel(id).ok).toBe(true)
    expect(service.cancel(id).ok).toBe(false)
    service.onEvent(turnEnd('src'))
    await vi.advanceTimersByTimeAsync(0)
    expect(target.prompts).toHaveLength(0)
  })

  it('forgetHost drops items where the host is target or source', () => {
    const a = makeHost('a')
    const b = makeHost('b')
    const c = makeHost('c')
    const service = new ScheduleService(filePath, fakePiHost([a, b, c]), () => {})
    service.schedule({ targetHostId: 'b', text: '1', trigger: { kind: 'after', sourceHostId: 'a', sourceTitle: 'A' } })
    service.schedule({ targetHostId: 'b', text: '2', trigger: { kind: 'after', sourceHostId: 'c', sourceTitle: 'C' } })
    service.forgetHost('a')
    expect(service.list()).toHaveLength(1)
    service.forgetHost('b')
    expect(service.list()).toHaveLength(0)
  })

  it('fires at-time via timer and persists across restart', async () => {
    const target = makeHost('tgt')
    const piHost = fakePiHost([target])
    const service = new ScheduleService(filePath, piHost, () => {})
    service.schedule({ targetHostId: 'tgt', text: 'timed', trigger: { kind: 'at', atEpochMs: Date.now() + 5000 } })
    expect(existsSync(filePath)).toBe(true)
    expect(target.prompts).toHaveLength(0)
    service.dispose()

    const reloaded = new ScheduleService(filePath, piHost, () => {})
    expect(reloaded.list()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(target.prompts).toEqual([{ text: 'timed', images: [], behavior: undefined }])
    expect(reloaded.list()).toHaveLength(0)
    expect(readItems(filePath)).toHaveLength(0)
  })

  it('fires overdue at-time immediately on load', async () => {
    const target = makeHost('tgt')
    const service = new ScheduleService(filePath, fakePiHost([target]), () => {})
    service.schedule({ targetHostId: 'tgt', text: 'late', trigger: { kind: 'at', atEpochMs: Date.now() - 1000 } })
    await vi.advanceTimersByTimeAsync(0)
    expect(target.prompts).toEqual([{ text: 'late', images: [], behavior: undefined }])

    const target2 = makeHost('tgt2')
    writeFileSync(filePath, JSON.stringify({
      version: 1,
      items: [{
        id: 'overdue',
        targetHostId: 'tgt2',
        targetTitle: 'Session tgt2',
        project,
        text: 'late',
        images: [],
        model: null,
        thinkingLevel: null,
        trigger: { kind: 'at', atEpochMs: Date.now() - 1000 },
        createdAt: Date.now()
      }]
    }))
    const reloaded = new ScheduleService(filePath, fakePiHost([target2]), () => {})
    await vi.advanceTimersByTimeAsync(0)
    expect(target2.prompts).toEqual([{ text: 'late', images: [], behavior: undefined }])
    expect(reloaded.list()).toHaveLength(0)
  })

  it('drops item silently when target is gone at fire time', async () => {
    const source = makeHost('src')
    const service = new ScheduleService(filePath, fakePiHost([source]), () => {})
    service.schedule({ targetHostId: 'gone', text: 'x', trigger: { kind: 'after', sourceHostId: 'src', sourceTitle: 'S' } })
    service.onEvent(turnEnd('src'))
    await vi.advanceTimersByTimeAsync(0)
    expect(service.list()).toHaveLength(0)
  })

  it('does not fire a far-future at-time immediately (setTimeout 2^31 clamp)', async () => {
    const target = makeHost('tgt')
    const service = new ScheduleService(filePath, fakePiHost([target]), () => {})
    service.schedule({ targetHostId: 'tgt', text: 'far', trigger: { kind: 'at', atEpochMs: Date.now() + 2 ** 32 } })
    await vi.advanceTimersByTimeAsync(60000)
    expect(target.prompts).toHaveLength(0)
    expect(service.list()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(2 ** 31)
    await vi.advanceTimersByTimeAsync(2 ** 31)
    expect(target.prompts).toEqual([{ text: 'far', images: [], behavior: undefined }])
    expect(service.list()).toHaveLength(0)
  })

  it('refuses scheduling into a missing target', () => {
    const service = new ScheduleService(filePath, fakePiHost([]), () => {})
    const result = service.schedule({ targetHostId: 'nope', text: 'x', trigger: { kind: 'at', atEpochMs: Date.now() + 1000 } })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Target session not found')
  })
})
