import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ScheduleService } from '../src/main/schedule/schedule-service'
import type { PiEventMessage, PiStatus, ScheduledPrompt, Settings } from '../src/shared/ipc-contracts'
import type { PiHost } from '../src/main/pi/pi-host'
import type { SessionHost } from '../src/main/pi/session-host'
import type { LoopController } from '../src/main/pi/loop-controller'

const project = { kind: 'native', dir: 'D:\\Work\\api' }

interface FakeHost {
  id: string
  streaming: boolean
  title: string
  prompts: { text: string; images: string[]; behavior?: string }[]
  models: string[]
  thinking: string[]
  failPrompt: boolean
}

interface FakeLoop {
  started: { hostId: string; prompt: string; maxIterations: number; exitCondition: string }[]
  stopped: string[]
  activeFor: string | null
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
          if (h.failPrompt) return Promise.resolve({ ok: false, error: 'boom' })
          h.prompts.push({ text, images, behavior })
          return Promise.resolve({ ok: true, error: null })
        }
      } as unknown as SessionHost
    }
  } as unknown as PiHost
}

function fakeLoops(overrides: Partial<FakeLoop> = {}): FakeLoop & LoopController {
  const loop: FakeLoop = { started: [], stopped: [], activeFor: null, ...overrides }
  return {
    ...loop,
    start: (hostId: string, prompt: string, maxIterations: number, exitCondition: string) => {
      loop.started.push({ hostId, prompt, maxIterations, exitCondition })
      return { active: true, remaining: maxIterations, reason: null }
    },
    stop: (hostId: string) => {
      loop.stopped.push(hostId)
      return null
    },
    get: (hostId: string) => (loop.activeFor === hostId ? { active: true, remaining: 5, reason: null } : null)
  } as unknown as FakeLoop & LoopController
}

function makeHost(id: string, streaming = false): FakeHost {
  return { id, streaming, title: `Session ${id}`, prompts: [], models: [], thinking: [], failPrompt: false }
}

function settings(loopsEnabled = true): () => Settings {
  return () => ({ loopsEnabled }) as unknown as Settings
}

function turnEnd(hostId: string, check = false): PiEventMessage {
  return { hostId, event: { type: 'turn_end', ...(check ? { check: true } : {}) } } as PiEventMessage
}

function status(hostId: string, state: string): PiStatus {
  return { hostId, state } as PiStatus
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
    const service = new ScheduleService(filePath, fakePiHost([source, target]), fakeLoops(), settings(), () => {})
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

  it('starts a loop with exit condition before the prompt', async () => {
    const source = makeHost('src')
    const target = makeHost('tgt')
    const loop = fakeLoops()
    const service = new ScheduleService(filePath, fakePiHost([source, target]), loop, settings(), () => {})
    service.schedule({
      targetHostId: 'tgt',
      text: 'loop it',
      trigger: { kind: 'after', sourceHostId: 'src', sourceTitle: 'S' },
      loop: { maxIterations: 7, exitCondition: 'when tests pass' }
    })
    service.onEvent(turnEnd('src'))
    await vi.advanceTimersByTimeAsync(0)
    expect(loop.started).toEqual([{ hostId: 'tgt', prompt: 'loop it', maxIterations: 7, exitCondition: 'when tests pass' }])
    expect(target.prompts).toEqual([{ text: 'loop it', images: [], behavior: undefined }])
    expect(loop.stopped).toEqual([])
  })

  it('skips loop start when loops are disabled or target already loops', async () => {
    const source = makeHost('src')
    const target = makeHost('tgt')
    const disabled = fakeLoops()
    const service = new ScheduleService(filePath, fakePiHost([source, target]), disabled, settings(false), () => {})
    service.schedule({
      targetHostId: 'tgt',
      text: 'a',
      trigger: { kind: 'after', sourceHostId: 'src', sourceTitle: 'S' },
      loop: { maxIterations: 3, exitCondition: '' }
    })
    service.onEvent(turnEnd('src'))
    await vi.advanceTimersByTimeAsync(0)
    expect(disabled.started).toHaveLength(0)
    expect(target.prompts).toHaveLength(1)

    const active = fakeLoops({ activeFor: 'tgt' })
    const service2 = new ScheduleService(filePath, fakePiHost([source, target]), active, settings(), () => {})
    service2.schedule({
      targetHostId: 'tgt',
      text: 'b',
      trigger: { kind: 'after', sourceHostId: 'src', sourceTitle: 'S' },
      loop: { maxIterations: 3, exitCondition: '' }
    })
    service2.onEvent(turnEnd('src'))
    await vi.advanceTimersByTimeAsync(0)
    expect(active.started).toHaveLength(0)
    expect(target.prompts).toHaveLength(2)
  })

  it('stops the loop when the prompt fails', async () => {
    const source = makeHost('src')
    const target = makeHost('tgt')
    target.failPrompt = true
    const loop = fakeLoops()
    const service = new ScheduleService(filePath, fakePiHost([source, target]), loop, settings(), () => {})
    service.schedule({
      targetHostId: 'tgt',
      text: 'x',
      trigger: { kind: 'after', sourceHostId: 'src', sourceTitle: 'S' },
      loop: { maxIterations: 3, exitCondition: '' }
    })
    service.onEvent(turnEnd('src'))
    await vi.advanceTimersByTimeAsync(0)
    expect(loop.started).toHaveLength(1)
    expect(loop.stopped).toEqual(['tgt'])
  })

  it('defers a loop item for a busy target and fires on ready', async () => {
    const source = makeHost('src')
    const target = makeHost('tgt', true)
    const loop = fakeLoops()
    const service = new ScheduleService(filePath, fakePiHost([source, target]), loop, settings(), () => {})
    service.schedule({
      targetHostId: 'tgt',
      text: 'deferred loop',
      trigger: { kind: 'after', sourceHostId: 'src', sourceTitle: 'S' },
      loop: { maxIterations: 5, exitCondition: 'done' }
    })
    service.onEvent(turnEnd('src'))
    await vi.advanceTimersByTimeAsync(0)
    expect(target.prompts).toHaveLength(0)
    expect(loop.started).toHaveLength(0)
    expect(service.list()).toHaveLength(1)

    target.streaming = false
    service.onStatus(status('tgt', 'ready'))
    await vi.advanceTimersByTimeAsync(0)
    expect(loop.started).toEqual([{ hostId: 'tgt', prompt: 'deferred loop', maxIterations: 5, exitCondition: 'done' }])
    expect(target.prompts).toEqual([{ text: 'deferred loop', images: [], behavior: undefined }])
    expect(service.list()).toHaveLength(0)
  })

  it('sends followUp to a busy target without loop and skips settings', async () => {
    const source = makeHost('src')
    const target = makeHost('tgt', true)
    const loop = fakeLoops()
    const service = new ScheduleService(filePath, fakePiHost([source, target]), loop, settings(), () => {})
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
    expect(loop.started).toHaveLength(0)
  })

  it('ignores check turn_end and unrelated hosts', async () => {
    const source = makeHost('src')
    const target = makeHost('tgt')
    const service = new ScheduleService(filePath, fakePiHost([source, target]), fakeLoops(), settings(), () => {})
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
    const service = new ScheduleService(filePath, fakePiHost([source, target]), fakeLoops(), settings(), () => {})
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
    const service = new ScheduleService(filePath, fakePiHost([a, b, c]), fakeLoops(), settings(), () => {})
    service.schedule({ targetHostId: 'b', text: '1', trigger: { kind: 'after', sourceHostId: 'a', sourceTitle: 'A' } })
    service.schedule({ targetHostId: 'b', text: '2', trigger: { kind: 'after', sourceHostId: 'c', sourceTitle: 'C' } })
    service.forgetHost('a')
    expect(service.list()).toHaveLength(1)
    service.forgetHost('b')
    expect(service.list()).toHaveLength(0)
  })

  it('fires at-time via timer and persists across restart with loop fields', async () => {
    const target = makeHost('tgt')
    const piHost = fakePiHost([target])
    const service = new ScheduleService(filePath, piHost, fakeLoops(), settings(), () => {})
    service.schedule({
      targetHostId: 'tgt',
      text: 'timed',
      trigger: { kind: 'at', atEpochMs: Date.now() + 5000 },
      loop: { maxIterations: 4, exitCondition: 'exit here' }
    })
    expect(existsSync(filePath)).toBe(true)
    expect(target.prompts).toHaveLength(0)
    service.dispose()

    const loop2 = fakeLoops()
    const reloaded = new ScheduleService(filePath, piHost, loop2, settings(), () => {})
    expect(reloaded.list()).toHaveLength(1)
    expect(reloaded.list()[0].loop).toEqual({ maxIterations: 4, exitCondition: 'exit here' })
    await vi.advanceTimersByTimeAsync(5000)
    expect(loop2.started).toEqual([{ hostId: 'tgt', prompt: 'timed', maxIterations: 4, exitCondition: 'exit here' }])
    expect(target.prompts).toEqual([{ text: 'timed', images: [], behavior: undefined }])
    expect(reloaded.list()).toHaveLength(0)
    expect(readItems(filePath)).toHaveLength(0)
  })

  it('fires overdue at-time immediately on load', async () => {
    const target = makeHost('tgt')
    const service = new ScheduleService(filePath, fakePiHost([target]), fakeLoops(), settings(), () => {})
    service.schedule({ targetHostId: 'tgt', text: 'late', trigger: { kind: 'at', atEpochMs: Date.now() - 1000 } })
    await vi.advanceTimersByTimeAsync(0)
    expect(target.prompts).toEqual([{ text: 'late', images: [], behavior: undefined }])

    const target2 = makeHost('tgt2')
    writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        items: [
          {
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
          }
        ]
      })
    )
    const reloaded = new ScheduleService(filePath, fakePiHost([target2]), fakeLoops(), settings(), () => {})
    await vi.advanceTimersByTimeAsync(0)
    expect(target2.prompts).toEqual([{ text: 'late', images: [], behavior: undefined }])
    expect(reloaded.list()).toHaveLength(0)
  })

  it('does not fire a far-future at-time immediately (setTimeout 2^31 clamp)', async () => {
    const target = makeHost('tgt')
    const service = new ScheduleService(filePath, fakePiHost([target]), fakeLoops(), settings(), () => {})
    service.schedule({ targetHostId: 'tgt', text: 'far', trigger: { kind: 'at', atEpochMs: Date.now() + 2 ** 32 } })
    await vi.advanceTimersByTimeAsync(60000)
    expect(target.prompts).toHaveLength(0)
    expect(service.list()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(2 ** 31)
    await vi.advanceTimersByTimeAsync(2 ** 31)
    expect(target.prompts).toEqual([{ text: 'far', images: [], behavior: undefined }])
    expect(service.list()).toHaveLength(0)
  })

  it('drops item silently when target is gone at fire time', async () => {
    const source = makeHost('src')
    const service = new ScheduleService(filePath, fakePiHost([source]), fakeLoops(), settings(), () => {})
    service.schedule({ targetHostId: 'gone', text: 'x', trigger: { kind: 'after', sourceHostId: 'src', sourceTitle: 'S' } })
    service.onEvent(turnEnd('src'))
    await vi.advanceTimersByTimeAsync(0)
    expect(service.list()).toHaveLength(0)
  })

  it('refuses scheduling into a missing target', () => {
    const service = new ScheduleService(filePath, fakePiHost([]), fakeLoops(), settings(), () => {})
    const result = service.schedule({ targetHostId: 'nope', text: 'x', trigger: { kind: 'at', atEpochMs: Date.now() + 1000 } })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Target session not found')
  })
})
