import { describe, expect, it, vi } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import { PiHost } from '../src/main/pi/pi-host'
import type { PiBackend } from '../src/main/pi/backends/types'
import type { CreateBackendResult } from '../src/main/pi/backends/factory'
import type { PiEventMessage, PiStatus } from '../src/shared/ipc-contracts'
import { DEFAULT_SETTINGS } from '../src/main/settings/settings'
import { ScriptedChild } from './helpers/fake-child'

const SETTINGS = { ...DEFAULT_SETTINGS }
const PROJECT = { kind: 'native' as const, dir: 'C:\\proj' }

let currentChild: ScriptedChild | null = null

function scriptedChild(sessionFile: string): ScriptedChild {
  return new ScriptedChild((type) => {
    if (type === 'get_state') {
      return {
        sessionId: 's-1',
        sessionFile,
        model: { provider: 'p', id: 'm', name: 'm', contextWindow: 1000, reasoning: true, input: ['text'] },
        thinkingLevel: 'off',
        autoCompactionEnabled: false
      }
    }
    if (type === 'get_available_models') return { models: [] }
    if (type === 'get_commands') return { commands: [] }
    if (type === 'get_available_thinking_levels') return { levels: ['off'] }
    if (type === 'prompt') {
      queueMicrotask(() => {
        currentChild?.emitData(
          '{"type":"message_end","message":{"role":"user","content":[{"type":"text","text":"ping"}]}}\n' +
            '{"type":"agent_start"}\n' +
            '{"type":"agent_settled","aborted":false}\n'
        )
      })
      return { disposition: 'started' }
    }
    return null
  })
}

function makePiHost(children: ScriptedChild[]): {
  piHost: PiHost
  events: PiEventMessage[]
  statuses: PiStatus[]
} {
  const events: PiEventMessage[] = []
  const statuses: PiStatus[] = []
  const backend: PiBackend = {
    displayName: 'fake',
    spawner: async () => {
      const child = children.shift()
      if (child === undefined) throw new Error('no more scripted children')
      return child as unknown as ChildProcess
    }
  }
  const created: CreateBackendResult = { backend, error: null }
  const piHost = new PiHost(
    () => SETTINGS,
    {
      onStatus: (s) => statuses.push(s),
      onEvent: (m) => events.push(m)
    },
    async () => created,
    async () => []
  )
  return { piHost, events, statuses }
}

describe('PiHost', () => {
  it('one session = one host, events carry hostId envelope', async () => {
    const child = scriptedChild('C:\\proj\\a.jsonl')
    currentChild = child
    const { piHost, events, statuses } = makePiHost([child])
    const host = piHost.create(PROJECT)
    expect(piHost.get(host.id)).toBe(host)
    await host.prompt('ping')
    await vi.waitFor(() => {
      expect(events.some((e) => e.event.type === 'turn_end')).toBe(true)
    })
    expect(events.every((e) => e.hostId === host.id)).toBe(true)
    expect(statuses.every((s) => s.hostId === host.id && s.project === PROJECT)).toBe(true)
    expect(statuses.some((s) => s.title === 'ping')).toBe(true)
    expect(statuses.some((s) => s.dot === 'busy')).toBe(true)
    host.dispose()
  })

  it('caches model catalog per backend kind and seeds new sessions before start', async () => {
    const child = new ScriptedChild((type) => {
      if (type === 'get_state') {
        return {
          sessionId: 's-1',
          sessionFile: 'C:\\proj\\a.jsonl',
          model: { provider: 'p', id: 'm', name: 'm', contextWindow: 1000, reasoning: true, input: ['text'] },
          thinkingLevel: 'off',
          autoCompactionEnabled: false
        }
      }
      if (type === 'get_available_models') {
        return { models: [{ provider: 'p', id: 'm', name: 'm', contextWindow: 1000, reasoning: true, input: ['text'] }] }
      }
      if (type === 'get_commands') return { commands: [] }
      if (type === 'get_available_thinking_levels') return { levels: ['off', 'high'] }
      if (type === 'prompt') {
        queueMicrotask(() => {
          currentChild?.emitData('{"type":"agent_start"}\n')
          currentChild?.emitData('{"type":"agent_settled","aborted":false}\n')
        })
        return { disposition: 'started' }
      }
      return null
    })
    currentChild = child
    const { piHost } = makePiHost([child])
    expect(piHost.hasCatalog('native')).toBe(false)
    const first = piHost.create(PROJECT)
    await first.prompt('ping')
    expect(piHost.hasCatalog('native')).toBe(true)
    const second = piHost.create(PROJECT)
    const idle = second.lastStatus()
    expect(idle?.state).toBe('idle')
    expect(idle?.models.length).toBe(1)
    expect(idle?.thinkingLevels).toEqual(['off', 'high'])
    second.dispose()
    first.dispose()
  })

  it('statuses() returns last status per host, close() removes the host', async () => {
    const child = scriptedChild('C:\\proj\\a.jsonl')
    const { piHost } = makePiHost([child])
    const host = piHost.create(PROJECT)
    await host.prompt('ping')
    await vi.waitFor(() => {
      expect(piHost.statuses().some((s) => s.state === 'ready')).toBe(true)
    })
    expect(piHost.close(host.id)).toEqual({ hostId: host.id })
    expect(piHost.get(host.id)).toBeNull()
    expect(piHost.statuses()).toEqual([])
    expect(piHost.close(host.id)).toBeNull()
  })

  it('openSession: sessionFile goes into spawn args and dot reflects pending dialogs', async () => {
    const child = new ScriptedChild((type) => {
      if (type === 'get_state') {
        return {
          sessionId: 's-1',
          sessionFile: 'C:\\proj\\a.jsonl',
          model: null,
          thinkingLevel: 'off',
          autoCompactionEnabled: false
        }
      }
      if (type === 'get_available_models') return { models: [] }
      if (type === 'get_commands') return { commands: [] }
      if (type === 'get_available_thinking_levels') return { levels: ['off'] }
      if (type === 'get_messages') return { messages: [{ role: 'user', content: [{ type: 'text', text: 'earlier' }] }] }
      if (type === 'prompt') {
        queueMicrotask(() => {
          child.emitData('{"type":"extension_ui_request","id":"u1","method":"confirm","title":"Run?","message":null}\n')
        })
        return { disposition: 'started' }
      }
      return null
    })
    const spawnArgs: string[][] = []
    const events: PiEventMessage[] = []
    const statuses: PiStatus[] = []
    const backend: PiBackend = {
      displayName: 'fake',
      spawner: async (req) => {
        spawnArgs.push(req.args)
        return child as unknown as ChildProcess
      }
    }
    const piHost = new PiHost(
      () => SETTINGS,
      { onStatus: (s) => statuses.push(s), onEvent: (m) => events.push(m) },
      async () => ({ backend, error: null }),
      async () => []
    )
    const host = piHost.create(PROJECT, 'C:\\proj\\a.jsonl')
    await host.prompt('go')
    await vi.waitFor(() => {
      expect(events.some((e) => e.event.type === 'dialog_open')).toBe(true)
    })
    expect(spawnArgs[0]).toEqual(['--mode', 'rpc', '--session', 'C:\\proj\\a.jsonl'])
    const last = statuses[statuses.length - 1]
    expect(last.dot).toBe('confirm')
    expect(last.title).toBe('earlier')
    host.dispose()
  })

  it('lastModel/lastThinkingLevel from settings seed new sessions, not resumed ones', async () => {
    const makeChild = (): ScriptedChild => {
      const self = new ScriptedChild((type) => {
        if (type === 'get_state') {
          return {
            sessionId: 's-1',
            sessionFile: 'C:\\proj\\a.jsonl',
            model: { provider: 'p', id: 'm', name: 'm', contextWindow: 1000, reasoning: true, input: ['text'] },
            thinkingLevel: 'off',
            autoCompactionEnabled: false
          }
        }
        if (type === 'get_available_models') {
          return { models: [{ provider: 'p', id: 'm2', name: 'm2', contextWindow: 1000, reasoning: true, input: ['text'] }] }
        }
        if (type === 'get_commands') return { commands: [] }
        if (type === 'get_available_thinking_levels') return { levels: ['off', 'low'] }
        if (type === 'prompt') {
          queueMicrotask(() => {
            self.emitData('{"type":"agent_start"}\n{"type":"agent_settled","aborted":false}\n')
          })
          return { disposition: 'started' }
        }
        return null
      })
      return self
    }
    const freshChild = makeChild()
    currentChild = freshChild
    SETTINGS.lastModel = 'p/m2'
    SETTINGS.lastThinkingLevel = 'low'
    const { piHost } = makePiHost([freshChild, makeChild()])
    const fresh = piHost.create(PROJECT)
    expect(fresh.lastStatus()?.model).toBe('p/m2')
    await fresh.prompt('ping')
    expect(freshChild.sent.some((c) => c['type'] === 'set_model' && c['provider'] === 'p' && c['modelId'] === 'm2')).toBe(true)
    fresh.dispose()

    const resumed = piHost.create(PROJECT, 'C:\\proj\\a.jsonl')
    expect(resumed.lastStatus()?.model).toBeNull()
    resumed.dispose()
    SETTINGS.lastModel = null
    SETTINGS.lastThinkingLevel = null
  })
})
