import { describe, expect, it, vi } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import { SessionHost } from '../src/main/pi/session-host'
import type { SessionHostListener } from '../src/main/pi/session-host'
import type { PiBackend } from '../src/main/pi/backends/types'
import type { CreateBackendResult } from '../src/main/pi/backends/factory'
import type { PiEventMessage, PiStatus, Settings } from '../src/shared/ipc-contracts'
import { ScriptedChild } from './helpers/fake-child'

const SETTINGS: Settings = { backend: 'native', wslDistro: '', piPath: '', projectDir: 'C:\\proj' }

function handshakeData(sessionFile: string): Record<string, unknown> {
  return {
    sessionId: 's-1',
    sessionFile,
    model: { provider: 'p', id: 'm', name: 'm', contextWindow: 1000, reasoning: true, input: ['text'] },
    thinkingLevel: 'off',
    autoCompactionEnabled: false
  }
}

function makeHost(
  children: ScriptedChild[],
  settings: Settings = SETTINGS
): {
  host: SessionHost
  events: PiEventMessage[]
  statuses: PiStatus[]
  spawnArgs: string[][]
} {
  const events: PiEventMessage[] = []
  const statuses: PiStatus[] = []
  const spawnArgs: string[][] = []
  const listener: SessionHostListener = {
    onEvent: (e) => events.push(e),
    onStatus: (s) => statuses.push(s)
  }
  const backend: PiBackend = {
    displayName: 'fake',
    spawner: async (req) => {
      spawnArgs.push(req.args)
      const child = children.shift()
      if (child === undefined) throw new Error('no more scripted children')
      return child as unknown as ChildProcess
    }
  }
  const created: CreateBackendResult = { backend, error: null }
  const host = new SessionHost(
    () => settings,
    listener,
    async () => created
  )
  return { host, events, statuses, spawnArgs }
}

function scriptedChild(sessionFile: string): ScriptedChild {
  return new ScriptedChild((type) => {
    if (type === 'get_state') return handshakeData(sessionFile)
    if (type === 'get_available_models') return { models: [] }
    if (type === 'get_commands') return { commands: [] }
    if (type === 'get_available_thinking_levels') return { levels: ['off'] }
    if (type === 'prompt') {
      queueMicrotask(() => {
        childEmitAgentTurn()
      })
      return { disposition: 'started' }
    }
    return null
  })
}

let currentChild: ScriptedChild | null = null

function childEmitAgentTurn(): void {
  currentChild?.emitData('{"type":"agent_start"}\n')
  currentChild?.emitData('{"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":1,"delta":"pong"}}\n')
  currentChild?.emitData('{"type":"agent_settled","aborted":false}\n')
}

describe('SessionHost', () => {
  it('starts lazily on first prompt, handshakes and streams', async () => {
    const child = scriptedChild('C:\\proj\\.pi\\sessions\\a.jsonl')
    currentChild = child
    const { host, events, statuses } = makeHost([child])
    const result = await host.prompt('ping')
    expect(result.ok).toBe(true)
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === 'agent_settled')).toBe(true)
    })
    expect(statuses.map((s) => s.state)).toContain('ready')
    expect(statuses.some((s) => s.state === 'streaming')).toBe(true)
    host.dispose()
  })

  it('restarts a dead process with --session on the next prompt', async () => {
    const first = scriptedChild('C:\\proj\\.pi\\sessions\\a.jsonl')
    const second = scriptedChild('C:\\proj\\.pi\\sessions\\a.jsonl')
    currentChild = first
    const { host, spawnArgs, statuses } = makeHost([first, second])
    await host.prompt('one')
    first.closeWith(1)
    await vi.waitFor(() => {
      expect(statuses.some((s) => s.state === 'disconnected')).toBe(true)
    })
    currentChild = second
    const result = await host.prompt('two')
    expect(result.ok).toBe(true)
    expect(spawnArgs).toHaveLength(2)
    expect(spawnArgs[0]).toEqual(['--mode', 'rpc'])
    expect(spawnArgs[1]).toEqual(['--mode', 'rpc', '--session', 'C:\\proj\\.pi\\sessions\\a.jsonl'])
    host.dispose()
  })

  it('reports backend resolution failure as an error status', async () => {
    const events: PiEventMessage[] = []
    const statuses: PiStatus[] = []
    const host = new SessionHost(
      () => SETTINGS,
      { onEvent: (e) => events.push(e), onStatus: (s) => statuses.push(s) },
      async () => ({ backend: null, error: 'no pi found' })
    )
    const result = await host.prompt('ping')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('no pi found')
    expect(statuses[statuses.length - 1].state).toBe('error')
    host.dispose()
  })

  it('rejects an empty project dir before spawning', async () => {
    const statuses: PiStatus[] = []
    const host = new SessionHost(
      () => ({ ...SETTINGS, projectDir: ' ' }),
      { onEvent: () => {}, onStatus: (s) => statuses.push(s) },
      async () => {
        throw new Error('backend factory must not be called')
      }
    )
    const result = await host.prompt('ping')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Project directory')
    host.dispose()
  })
})
