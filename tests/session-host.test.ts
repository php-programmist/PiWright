import { describe, expect, it, vi } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import { SessionHost } from '../src/main/pi/session-host'
import type { SessionHostListener } from '../src/main/pi/session-host'
import type { PiBackend } from '../src/main/pi/backends/types'
import type { CreateBackendResult } from '../src/main/pi/backends/factory'
import type { PiStatus, Settings } from '../src/shared/ipc-contracts'
import type { UiEvent } from '../src/shared/agent-events'
import { ScriptedChild } from './helpers/fake-child'

const SETTINGS: Settings = { wslDistro: '', piPathNative: '', piPathWsl: '', piExtraArgs: '', updateUrl: '', selectorPlacement: 'top', panels: {}, projects: [] }
const PROJECT = { kind: 'native' as const, dir: 'C:\\proj' }

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
  events: UiEvent[]
  statuses: PiStatus[]
  spawnArgs: string[][]
} {
  const events: UiEvent[] = []
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
  const host = new SessionHost(() => settings, listener, PROJECT, { createBackend: async () => created })
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
      expect(events.some((e) => e.type === 'turn_end')).toBe(true)
    })
    expect(statuses.map((s) => s.state)).toContain('ready')
    expect(statuses.some((s) => s.state === 'streaming')).toBe(true)
    host.dispose()
  })

  it('restarts a dead process with --session on the next prompt and replays history', async () => {
    const first = scriptedChild('C:\\proj\\.pi\\sessions\\a.jsonl')
    const second = new ScriptedChild((type) => {
      if (type === 'get_state') return handshakeData('C:\\proj\\.pi\\sessions\\a.jsonl')
      if (type === 'get_available_models') return { models: [] }
      if (type === 'get_commands') return { commands: [] }
      if (type === 'get_available_thinking_levels') return { levels: ['off'] }
      if (type === 'get_messages') {
        return {
          messages: [
            { role: 'user', content: [{ type: 'text', text: 'earlier question' }] },
            { role: 'assistant', content: [{ type: 'text', text: 'earlier answer' }] }
          ]
        }
      }
      if (type === 'prompt') {
        queueMicrotask(() => {
          childEmitAgentTurn()
        })
        return { disposition: 'started' }
      }
      return null
    })
    currentChild = first
    const { host, spawnArgs, statuses, events } = makeHost([first, second])
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
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === 'injected_user_message' && e.text === 'earlier question')).toBe(true)
    })
    host.dispose()
  })

  it('reports backend resolution failure as an error status', async () => {
    const events: UiEvent[] = []
    const statuses: PiStatus[] = []
    const host = new SessionHost(
      () => SETTINGS,
      { onEvent: (e) => events.push(e), onStatus: (s) => statuses.push(s) },
      PROJECT,
      { createBackend: async () => ({ backend: null, error: 'no pi found' }) }
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
      () => ({ ...SETTINGS }),
      { onEvent: () => {}, onStatus: (s) => statuses.push(s) },
      { kind: 'native', dir: ' ' },
      { createBackend: async () => {
        throw new Error('backend factory must not be called')
      } }
    )
    const result = await host.prompt('ping')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Project directory')
    host.dispose()
  })

  it('extension_ui_request dialogs open, first answer wins, fire-and-forget methods are ignored', async () => {
    const child = new ScriptedChild((type) => {
      if (type === 'get_state') return handshakeData('C:\\proj\\.pi\\sessions\\a.jsonl')
      if (type === 'get_available_models') return { models: [] }
      if (type === 'get_commands') return { commands: [] }
      if (type === 'get_available_thinking_levels') return { levels: ['off'] }
      if (type === 'prompt') {
        queueMicrotask(() => {
          child?.emitData(
            '{"type":"extension_ui_request","id":"u1","method":"confirm","title":"Run?","message":"rm -rf"}\n' +
              '{"type":"extension_ui_request","id":"u2","method":"notify","message":"hi"}\n'
          )
        })
        return { disposition: 'started' }
      }
      return null
    })
    currentChild = child
    const { host, events } = makeHost([child])
    await host.prompt('go')
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === 'dialog_open')).toBe(true)
    })
    expect(events.some((e) => e.type === 'dialog_open' && e.dialog.kind === 'confirm')).toBe(true)
    expect(events.some((e) => e.type === 'dialog_open' && e.dialog.kind === 'input')).toBe(false)
    expect(host.getPendingDialogs()).toHaveLength(1)

    const first = host.respondDialog('u1', { kind: 'confirmed', confirmed: true })
    expect(first.ok).toBe(true)
    const second = host.respondDialog('u1', { kind: 'confirmed', confirmed: false })
    expect(second.ok).toBe(false)
    expect(host.getPendingDialogs()).toHaveLength(0)
    const sent = child.sent.filter((c) => c['type'] === 'extension_ui_response')
    expect(sent).toEqual([{ type: 'extension_ui_response', id: 'u1', confirmed: true }])
    host.dispose()
  })

  it('abort clears the queue then aborts', async () => {
    const child = new ScriptedChild((type) => {
      if (type === 'get_state') return handshakeData('C:\\proj\\.pi\\sessions\\a.jsonl')
      if (type === 'get_available_models') return { models: [] }
      if (type === 'get_commands') return { commands: [] }
      if (type === 'get_available_thinking_levels') return { levels: ['off'] }
      if (type === 'clear_queue') return { steering: ['stop that'], followUp: [] }
      return null
    })
    currentChild = child
    const { host, events } = makeHost([child])
    await host.prompt('go')
    const result = await host.abort()
    expect(result.ok).toBe(true)
    expect(result.error).toBeNull()
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === 'queue_update' && e.steering.length === 0 && e.followUp.length === 0)).toBe(true)
    })
    const types = child.sent.map((c) => c['type'])
    expect(types.indexOf('clear_queue')).toBeGreaterThanOrEqual(0)
    expect(types.indexOf('abort')).toBeGreaterThan(types.indexOf('clear_queue'))
    host.dispose()
  })

  it('setModel and setThinkingLevel send protocol commands and refresh thinking state', async () => {
    const child = new ScriptedChild((type) => {
      if (type === 'get_state') {
        return { ...handshakeData('C:\\proj\\.pi\\sessions\\a.jsonl'), thinkingLevel: 'low' }
      }
      if (type === 'get_available_models') {
        return { models: [{ provider: 'p', id: 'm', name: 'm', contextWindow: 1000, reasoning: true, input: ['text'] }] }
      }
      if (type === 'get_commands') return { commands: [] }
      if (type === 'get_available_thinking_levels') return { levels: ['off', 'low'] }
      return null
    })
    currentChild = child
    const { host, statuses } = makeHost([child])
    await host.prompt('go')
    const modelResult = await host.setModel('p/m')
    expect(modelResult.ok).toBe(true)
    const setModel = child.sent.find((c) => c['type'] === 'set_model')
    expect(setModel).toMatchObject({ provider: 'p', modelId: 'm' })
    const thinkingResult = await host.setThinkingLevel('low')
    expect(thinkingResult.ok).toBe(true)
    expect(child.sent.some((c) => c['type'] === 'set_thinking_level' && c['level'] === 'low')).toBe(true)
    expect(statuses.some((s) => s.thinkingLevel === 'low')).toBe(true)
    host.dispose()
  })
})
