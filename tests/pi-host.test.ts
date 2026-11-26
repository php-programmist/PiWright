import { describe, expect, it, vi } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import { PiHost } from '../src/main/pi/pi-host'
import type { PiBackend } from '../src/main/pi/backends/types'
import type { CreateBackendResult } from '../src/main/pi/backends/factory'
import type { PiEventMessage, PiStatus, SavedSessionTab } from '../src/shared/ipc-contracts'
import { DEFAULT_SETTINGS } from '../src/main/settings/settings'
import { DaemonClient, setDaemonClientForTests } from '../src/main/daemon/client'
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

  it('createFork: new host inherits parent session file, name gets (fork), events carry new hostId', async () => {
    const child = new ScriptedChild((type) => {
      if (type === 'get_state') {
        return {
          sessionId: 's-2',
          sessionFile: 'C:\\proj\\branch.jsonl',
          model: { provider: 'p', id: 'm', name: 'm', contextWindow: 1000, reasoning: true, input: ['text'] },
          thinkingLevel: 'off',
          autoCompactionEnabled: false
        }
      }
      if (type === 'get_available_models') return { models: [] }
      if (type === 'get_commands') return { commands: [] }
      if (type === 'get_available_thinking_levels') return { levels: ['off'] }
      if (type === 'get_messages') return { messages: [{ role: 'user', content: [{ type: 'text', text: 'earlier' }] }] }
      return null
    })
    currentChild = child
    const forkChild = new ScriptedChild((type) => {
      if (type === 'get_state') {
        return {
          sessionId: 's-2',
          sessionFile: 'C:\\proj\\branch.jsonl',
          model: { provider: 'p', id: 'm', name: 'm', contextWindow: 1000, reasoning: true, input: ['text'] },
          thinkingLevel: 'off',
          autoCompactionEnabled: false
        }
      }
      if (type === 'get_available_models') return { models: [] }
      if (type === 'get_commands') return { commands: [] }
      if (type === 'get_available_thinking_levels') return { levels: ['off'] }
      if (type === 'get_messages') return { messages: [{ role: 'user', content: [{ type: 'text', text: 'earlier' }] }] }
      return null
    })
    const titleChild = new ScriptedChild((type) => {
      if (type === 'get_state') {
        return {
          sessionId: 's-t',
          sessionFile: 'C:\\proj\\title.jsonl',
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
          titleChild.emitData('{"type":"agent_settled","aborted":false}\n')
        })
        return { disposition: 'started' }
      }
      return null
    })
    const { piHost, events, statuses } = makePiHost([child, titleChild, forkChild])
    const parent = piHost.create(PROJECT)
    await parent.prompt('ping')
    await vi.waitFor(() => {
      expect(parent.lastStatus()?.state).toBe('ready')
    })
    const forked = piHost.createFork(parent.id, { userText: null, occurrence: 0 })
    expect(forked).not.toBeNull()
    await forked!.ensureStarted()
    expect(forkChild.sent.some((c) => c['type'] === 'clone')).toBe(true)
    // Название не сгенерировалось — родитель получил запасное из первых слов, форк наследует его.
    expect(forked!.lastStatus()?.title).toBe('(fork) ping')
    expect(forked!.lastStatus()?.sessionFile).toBe('C:\\proj\\branch.jsonl')
    expect(events.filter((e) => e.hostId === forked!.id).length).toBeGreaterThan(0)
    expect(statuses.some((s) => s.hostId === forked!.id)).toBe(true)
    forked!.dispose()
    parent.dispose()
  })

  it('createFork returns null for unknown host or a session without a file', () => {
    const { piHost } = makePiHost([])
    expect(piHost.createFork('no-such-host', { userText: null, occurrence: 0 })).toBeNull()
    const host = piHost.create(PROJECT)
    expect(piHost.createFork(host.id, { userText: null, occurrence: 0 })).toBeNull()
    host.dispose()
  })

  it('closeAndWait removes the host from the registry (false for unknown id)', async () => {
    const { piHost } = makePiHost([])
    const host = piHost.create(PROJECT)
    expect(await piHost.closeAndWait(host.id)).toBe(true)
    expect(piHost.get(host.id)).toBeNull()
    expect(await piHost.closeAndWait('no-such-host')).toBe(false)
  })

  it('close keepAlive: idle session is killed, streaming session detaches', async () => {
    // Idle (ход завершился) — kill сразу: держать агента в памяти дороже восстановления.
    const child = scriptedChild('C:\\proj\\a.jsonl')
    currentChild = child
    const { piHost } = makePiHost([child])
    const host = piHost.create(PROJECT, 'C:\\proj\\a.jsonl')
    await host.ensureStarted()
    expect(host.streaming).toBe(false)
    piHost.close(host.id, { keepAlive: true })
    expect(piHost.get(host.id)).toBeNull()
    expect(child.stdin.writableEnded).toBe(true)

    // Streaming (ход идёт) — detach: ребёнок жив, ход дозреет в фоне.
    const busyChild = new ScriptedChild((type) => {
      if (type === 'get_state') {
        return {
          sessionId: 's-1',
          sessionFile: 'C:\\proj\\b.jsonl',
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
          busyChild.emitData('{"type":"agent_start"}\n')
        })
        return { disposition: 'started' }
      }
      return null
    })
    ;(busyChild as unknown as { sessionKey: string }).sessionKey = 'k-2'
    currentChild = busyChild
    const second = makePiHost([busyChild])
    const host2 = second.piHost.create(PROJECT, 'C:\\proj\\b.jsonl')
    await host2.prompt('go')
    await vi.waitFor(() => {
      expect(host2.streaming).toBe(true)
    })
    second.piHost.close(host2.id, { keepAlive: true })
    expect(second.piHost.get(host2.id)).toBeNull()
    expect(busyChild.stdin.writableEnded).toBe(false)
    expect(busyChild.killed).toBe(false)

    // Явный kill — всегда dispose, даже во время хода.
    const busyChild2 = new ScriptedChild((type) => {
      if (type === 'get_state') {
        return {
          sessionId: 's-1',
          sessionFile: 'C:\\proj\\c.jsonl',
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
          busyChild2.emitData('{"type":"agent_start"}\n')
        })
        return { disposition: 'started' }
      }
      return null
    })
    currentChild = busyChild2
    const third = makePiHost([busyChild2])
    const host3 = third.piHost.create(PROJECT, 'C:\\proj\\c.jsonl')
    await host3.prompt('go')
    await vi.waitFor(() => {
      expect(host3.streaming).toBe(true)
    })
    third.piHost.close(host3.id)
    expect(busyChild2.stdin.writableEnded).toBe(true)
  })

  it('detached session keeps its restore tab; quiesceForQuit kills idle, detaches streaming', async () => {
    // Idle-сессия при выходе: процесс убит, вкладка восстановления сохранена (респавн из транскрипта).
    const child = scriptedChild('C:\\proj\\a.jsonl')
    currentChild = child
    const persisted: SavedSessionTab[][] = []
    const backend: PiBackend = {
      displayName: 'fake',
      spawner: async () => child as unknown as ChildProcess
    }
    const created: CreateBackendResult = { backend, error: null }
    const piHost = new PiHost(
      () => SETTINGS,
      { onStatus: () => {}, onEvent: () => {} },
      async () => created,
      async () => [],
      null,
      (tabs) => persisted.push([...tabs])
    )
    const host = piHost.create(PROJECT, 'C:\\proj\\a.jsonl')
    await host.ensureStarted()
    piHost.quiesceForQuit()
    expect(piHost.get(host.id)).toBeNull()
    expect(child.stdin.writableEnded).toBe(true)
    expect(persisted).toHaveLength(1) // вкладка записана при create и не забылась при quit

    // Streaming-сессия при выходе: отвязана, stdin открыт — ход дозреет в фоне.
    const busyChild = new ScriptedChild((type) => {
      if (type === 'get_state') {
        return {
          sessionId: 's-1',
          sessionFile: 'C:\\proj\\b.jsonl',
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
          busyChild.emitData('{"type":"agent_start"}\n')
        })
        return { disposition: 'started' }
      }
      return null
    })
    ;(busyChild as unknown as { sessionKey: string }).sessionKey = 'k-2'
    currentChild = busyChild
    const second = makePiHost([busyChild])
    const host2 = second.piHost.create(PROJECT, 'C:\\proj\\b.jsonl')
    await host2.prompt('go')
    await vi.waitFor(() => {
      expect(host2.streaming).toBe(true)
    })
    second.piHost.quiesceForQuit()
    expect(second.piHost.get(host2.id)).toBeNull()
    expect(busyChild.stdin.writableEnded).toBe(false)
    expect(busyChild.killed).toBe(false)
  })

  it('persists open session tabs on create and removes on close', async () => {
    const child = scriptedChild('C:\\proj\\a.jsonl')
    ;(child as unknown as { sessionKey: string }).sessionKey = 'k-1'
    currentChild = child
    setDaemonClientForTests({ rekey: async () => {} } as unknown as DaemonClient)
    const persisted: SavedSessionTab[][] = []
    const backend: PiBackend = {
      displayName: 'fake',
      spawner: async () => child as unknown as ChildProcess
    }
    const created: CreateBackendResult = { backend, error: null }
    const piHost = new PiHost(
      () => SETTINGS,
      { onStatus: () => {}, onEvent: () => {} },
      async () => created,
      async () => [],
      null,
      (tabs) => persisted.push([...tabs])
    )
    const host = piHost.create(PROJECT, 'C:\\proj\\a.jsonl')
    expect(persisted).toEqual([[{ project: PROJECT, sessionFile: 'C:\\proj\\a.jsonl' }]])
    piHost.close(host.id)
    expect(persisted[persisted.length - 1]).toEqual([])
    setDaemonClientForTests(null)
  })

  it('ensureAllStarted starts restored hosts and is idempotent', async () => {
    const child = scriptedChild('C:\\proj\\a.jsonl')
    currentChild = child
    const { piHost } = makePiHost([child])
    const host = piHost.create(PROJECT, 'C:\\proj\\a.jsonl')
    piHost.ensureAllStarted()
    await vi.waitFor(() => {
      expect(host.lastStatus()?.state).toBe('ready')
    })
    // Хендшейк шлёт get_state дважды (уровни thinking) — повторный ensureAllStarted не добавляет.
    const afterFirst = child.sent.filter((c) => c['type'] === 'get_state').length
    expect(afterFirst).toBe(2)
    piHost.ensureAllStarted()
    expect(child.sent.filter((c) => c['type'] === 'get_state')).toHaveLength(afterFirst)
  })
})
