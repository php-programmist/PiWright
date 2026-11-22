import { describe, expect, it, vi } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import { SessionHost } from '../src/main/pi/session-host'
import type { SessionHostListener, SessionHostOptions } from '../src/main/pi/session-host'
import type { PiBackend } from '../src/main/pi/backends/types'
import type { CreateBackendResult } from '../src/main/pi/backends/factory'
import type { PiStatus, Settings } from '../src/shared/ipc-contracts'
import { DEFAULT_SETTINGS } from '../src/main/settings/settings'
import type { UiEvent } from '../src/shared/agent-events'
import { ScriptedChild } from './helpers/fake-child'

const SETTINGS = { ...DEFAULT_SETTINGS }
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
  settings: Settings = SETTINGS,
  hostOpts: Partial<SessionHostOptions> = {}
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
  const host = new SessionHost(() => settings, listener, PROJECT, {
    createBackend: async () => created,
    installExtensions: async () => [],
    ...hostOpts
  })
  return { host, events, statuses, spawnArgs }
}

function scriptedChild(sessionFile: string): ScriptedChild {
  return new ScriptedChild((type) => {
    if (type === 'get_state') return handshakeData(sessionFile)
    if (type === 'get_available_models') return { models: [] }
    if (type === 'get_commands') return { commands: [] }
    if (type === 'get_session_stats') return { tokens: { input: 100, output: 20, cacheRead: 900, cacheWrite: 30 } }
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

/** Одноразовый pi для generateSessionTitle: отвечает agent_settled без текста — название не генерируется. */
function nullTitleChild(): ScriptedChild {
  const child = new ScriptedChild((type) => {
    if (type === 'get_state') return handshakeData('C:\\proj\\.pi\\sessions\\title.jsonl')
    if (type === 'prompt') {
      queueMicrotask(() => child.emitData('{"type":"agent_settled","aborted":false}\n'))
      return { disposition: 'started' }
    }
    return null
  })
  return child
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
    const { host, spawnArgs, statuses, events } = makeHost([first, nullTitleChild(), second])
    await host.prompt('one')
    first.closeWith(1)
    await vi.waitFor(() => {
      expect(statuses.some((s) => s.state === 'disconnected')).toBe(true)
    })
    currentChild = second
    const result = await host.prompt('two')
    expect(result.ok).toBe(true)
    expect(spawnArgs).toHaveLength(3)
    expect(spawnArgs[0]).toEqual(['--mode', 'rpc'])
    // Первая попытка generateSessionTitle: детей в скрипте нет — спавн падает, промпт уходит без названия.
    expect(spawnArgs[1]).toEqual(['--mode', 'rpc', '--no-session', '--no-extensions', '--no-tools', '--no-mcp'])
    expect(spawnArgs[2]).toEqual(['--mode', 'rpc', '--session', 'C:\\proj\\.pi\\sessions\\a.jsonl'])
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === 'injected_user_message' && e.text === 'earlier question')).toBe(true)
    })
    host.dispose()
  })

  it('resume from history keeps the persisted session name, not the first prompt', async () => {
    const child = new ScriptedChild((type) => {
      if (type === 'get_state') return { ...handshakeData('C:\\proj\\.pi\\sessions\\a.jsonl'), sessionName: 'Agent-given name' }
      if (type === 'get_available_models') return { models: [] }
      if (type === 'get_commands') return { commands: [] }
      if (type === 'get_session_stats') return { tokens: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } }
      if (type === 'get_available_thinking_levels') return { levels: ['off'] }
      if (type === 'get_messages') {
        return { messages: [{ role: 'user', content: [{ type: 'text', text: 'the entire first prompt of a very long session' }] }] }
      }
      return null
    })
    const { host, statuses } = makeHost([child], SETTINGS, { sessionFile: 'C:\\proj\\.pi\\sessions\\a.jsonl' })
    await host.ensureStarted()
    const last = statuses[statuses.length - 1]
    expect(last?.title).toBe('Agent-given name')
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

  it('extension_ui_request dialogs open, first answer wins, fire-and-forget methods are ignored', async () => {    const child = new ScriptedChild((type) => {
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
    expect(events.some((e) => e.type === 'dialog_answered' && e.id === 'u1' && e.by === 'pc')).toBe(true)
    host.dispose()
  })

  it('phone answer via respondRemoteUi clears the pending dialog and emits dialog_answered', async () => {
    const child = new ScriptedChild((type) => {
      if (type === 'get_state') return handshakeData('C:\\proj\\.pi\\sessions\\a.jsonl')
      if (type === 'get_available_models') return { models: [] }
      if (type === 'get_commands') return { commands: [] }
      if (type === 'get_available_thinking_levels') return { levels: ['off'] }
      if (type === 'prompt') {
        queueMicrotask(() => {
          child?.emitData('{"type":"extension_ui_request","id":"u1","method":"confirm","title":"Run?"}\n')
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

    host.respondRemoteUi('u1', { confirmed: true })
    expect(host.getPendingDialogs()).toHaveLength(0)
    expect(events.some((e) => e.type === 'dialog_answered' && e.id === 'u1' && e.by === 'phone')).toBe(true)
    expect(child.sent.filter((c) => c['type'] === 'extension_ui_response')).toEqual([
      { type: 'extension_ui_response', id: 'u1', confirmed: true }
    ])
    host.dispose()
  })

  it('ask_question input request opens an ask dialog and the answer is a JSON value', async () => {
    const questions = [
      {
        header: 'Auth',
        question: 'Which auth?',
        options: [
          { label: 'A', description: 'first' },
          { label: 'B', description: 'second' }
        ]
      }
    ]
    const title = 'pi-wrapper:ask:' + Buffer.from(JSON.stringify({ questions }), 'utf8').toString('base64')
    const child = new ScriptedChild((type) => {
      if (type === 'get_state') return handshakeData('C:\\proj\\.pi\\sessions\\a.jsonl')
      if (type === 'get_available_models') return { models: [] }
      if (type === 'get_commands') return { commands: [] }
      if (type === 'get_available_thinking_levels') return { levels: ['off'] }
      if (type === 'prompt') {
        queueMicrotask(() => {
          child?.emitData(`{"type":"extension_ui_request","id":"u9","method":"input","title":${JSON.stringify(title)}}\n`)
        })
        return { disposition: 'started' }
      }
      return null
    })
    currentChild = child
    const { host, events } = makeHost([child])
    await host.prompt('go')
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === 'dialog_open' && e.dialog.kind === 'ask')).toBe(true)
    })
    const answer = host.respondDialog('u9', { kind: 'value', value: '{"answers":[],"cancelled":false}' })
    expect(answer.ok).toBe(true)
    const sent = child.sent.filter((c) => c['type'] === 'extension_ui_response')
    expect(sent).toEqual([{ type: 'extension_ui_response', id: 'u9', value: '{"answers":[],"cancelled":false}' }])
    host.dispose()
  })

  it('ask extension path from the installer goes into pi args as -e', async () => {
    const child = scriptedChild('C:\\proj\\.pi\\sessions\\a.jsonl')
    currentChild = child
    const events: UiEvent[] = []
    const statuses: PiStatus[] = []
    const spawnArgs: string[][] = []
    let spawns = 0
    const backend: PiBackend = {
      displayName: 'fake',
      spawner: async (req) => {
        spawnArgs.push(req.args)
        if (spawns++ > 0) throw new Error('unexpected second spawn')
        return child as unknown as ChildProcess
      }
    }
    const host = new SessionHost(() => SETTINGS, { onEvent: (e) => events.push(e), onStatus: (s) => statuses.push(s) }, PROJECT, {
      createBackend: async () => ({ backend, error: null }),
      installExtensions: async () => ['C:\\ext\\ask-question', 'C:\\ext\\session-tools']
    })
    await host.prompt('ping')
    expect(spawnArgs[0]).toEqual([
      '--mode',
      'rpc',
      '-e',
      'C:\\ext\\ask-question',
      '-e',
      'C:\\ext\\session-tools'
    ])
    host.dispose()
  })

  it('WSL bundled extension UNC paths are converted to POSIX for pi args', async () => {
    const child = scriptedChild('/home/u/proj/.pi/sessions/a.jsonl')
    currentChild = child
    const spawnArgs: string[][] = []
    let spawns = 0
    const backend: PiBackend = {
      displayName: 'fake',
      spawner: async (req) => {
        spawnArgs.push(req.args)
        if (spawns++ > 0) throw new Error('unexpected second spawn')
        return child as unknown as ChildProcess
      }
    }
    const host = new SessionHost(
      () => SETTINGS,
      { onEvent: () => {}, onStatus: () => {} },
      { kind: 'wsl', dir: '\\\\wsl.localhost\\Ubuntu\\home\\u\\proj' },
      {
        createBackend: async () => ({ backend, error: null }),
        installExtensions: async () => [
          '\\\\wsl.localhost\\Ubuntu\\home\\u\\.pi\\agent\\piwright\\ask-question',
          '\\\\wsl.localhost\\Ubuntu\\home\\u\\.pi\\agent\\piwright\\session-tools'
        ]
      }
    )
    await host.prompt('ping')
    expect(spawnArgs[0]).toEqual([
      '--mode',
      'rpc',
      '-e',
      '/home/u/.pi/agent/piwright/ask-question',
      '-e',
      '/home/u/.pi/agent/piwright/session-tools'
    ])
    host.dispose()
  })

  it('setWidget and setStatus extension requests become widget and status events', async () => {
    const child = new ScriptedChild((type) => {
      if (type === 'get_state') return handshakeData('C:\\proj\\.pi\\sessions\\a.jsonl')
      if (type === 'get_available_models') return { models: [] }
      if (type === 'get_commands') return { commands: [] }
      if (type === 'get_available_thinking_levels') return { levels: ['off'] }
      if (type === 'prompt') {
        queueMicrotask(() => {
          child?.emitData(
            '{"type":"extension_ui_request","id":"w1","method":"setWidget","widgetKey":"pi-agent-desktop:todo","widgetLines":["{\\"subject\\":\\"a\\",\\"status\\":\\"pending\\"}"]}\n' +
              '{"type":"extension_ui_request","id":"s1","method":"setStatus","statusKey":"lsp","statusText":"\\u001b[2mLSP: idle\\u001b[22;39m"}\n'
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
      expect(events.some((e) => e.type === 'widget')).toBe(true)
    })
    expect(events.some((e) => e.type === 'widget' && e.key === 'pi-agent-desktop:todo' && e.lines?.length === 1)).toBe(true)
    expect(events.some((e) => e.type === 'extension_status' && e.key === 'lsp' && e.text === 'LSP: idle')).toBe(true)
    host.dispose()
  })

  it('session stats arrive after the handshake and refresh after each turn', async () => {
    const child = scriptedChild('C:\\proj\\.pi\\sessions\\a.jsonl')
    currentChild = child
    const { host, events } = makeHost([child])
    await host.prompt('ping')
    await vi.waitFor(() => {
      expect(events.filter((e) => e.type === 'session_stats').length).toBeGreaterThanOrEqual(2)
    })
    const stats = events.filter((e): e is Extract<UiEvent, { type: 'session_stats' }> => e.type === 'session_stats')
    expect(stats[0].tokens).toEqual({ input: 100, output: 20, cacheRead: 900, cacheWrite: 30 })
    expect(child.sent.some((c) => c['type'] === 'get_session_stats')).toBe(true)
    host.dispose()
  })

  it('prompt with image names sends base64 image blocks only for image-capable models', async () => {
    const { promises: fs } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const dir = join(tmpdir(), `piwright-sh-${Date.now()}`)
    await fs.mkdir(join(dir, '.pi', 'attachments'), { recursive: true })
    await fs.writeFile(join(dir, '.pi', 'attachments', 'pic.png'), Buffer.from([1, 2, 3]))
    const makeTmpHost = (modelInput: string[]): { host: SessionHost; child: ScriptedChild } => {
      const spawns: string[][] = []
      const c = new ScriptedChild((type) => {
        if (type === 'get_state') {
          return {
            ...handshakeData('x'),
            model: { provider: 'p', id: 'm', name: 'm', contextWindow: 1000, reasoning: true, input: modelInput }
          }
        }
        if (type === 'get_available_models') return { models: [] }
        if (type === 'get_commands') return { commands: [] }
        if (type === 'get_available_thinking_levels') return { levels: ['off'] }
        return null
      })
      currentChild = c
      const h = new SessionHost(() => SETTINGS, { onEvent: () => {}, onStatus: () => {} }, { kind: 'native', dir }, {
        createBackend: async () => ({
          backend: {
            displayName: 'fake',
            spawner: async (req) => {
              spawns.push(req.args)
              if (spawns.length > 1) throw new Error('unexpected second spawn')
              return c as unknown as ChildProcess
            }
          },
          error: null
        }),
        installExtensions: async () => []
      })
      return { host: h, child: c }
    }
    const { host, child } = makeTmpHost(['text', 'image'])
    await host.prompt('look', ['pic.png', 'note.txt'])
    const frame = child.sent.find((c) => c['type'] === 'prompt')
    expect(frame).toMatchObject({
      message: 'look',
      images: [{ type: 'image', data: Buffer.from([1, 2, 3]).toString('base64'), mimeType: 'image/png' }]
    })
    host.dispose()

    const second = makeTmpHost(['text'])
    await second.host.prompt('look', ['pic.png'])
    const frame2 = second.child.sent.find((c) => c['type'] === 'prompt')
    expect(frame2).toMatchObject({ message: 'look' })
    expect(frame2).not.toHaveProperty('images')
    second.host.dispose()
  })

  it('turn with a running subagent goes to waiting and resolves turn_end only after it completes', async () => {
    const child = new ScriptedChild((type) => {
      if (type === 'get_state') return handshakeData('C:\\proj\\.pi\\sessions\\a.jsonl')
      if (type === 'get_available_models') return { models: [] }
      if (type === 'get_commands') return { commands: [] }
      if (type === 'get_available_thinking_levels') return { levels: ['off'] }
      if (type === 'get_session_stats') return { tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }
      if (type === 'prompt') {
        queueMicrotask(() => {
          child?.emitData(
            '{"type":"agent_start"}\n' +
              '{"type":"tool_execution_start","toolCallId":"t1","toolName":"Agent","args":{},"parentToolCallId":null}\n' +
              '{"type":"entry_appended","entry":{"customType":"piwright:subagents","data":{"kind":"started","id":"sa-1"}}}\n' +
              '{"type":"agent_settled","aborted":false}\n'
          )
        })
        return { disposition: 'started' }
      }
      return null
    })
    currentChild = child
    const { host, events, statuses } = makeHost([child], SETTINGS, { subagentGraceMs: 20 })
    await host.prompt('go')
    await vi.waitFor(() => {
      expect(statuses[statuses.length - 1]?.state).toBe('waiting')
    })
    expect(statuses[statuses.length - 1]?.dot).toBe('waiting')
    expect(events.some((e) => e.type === 'turn_end')).toBe(false)
    child.emitData('{"type":"entry_appended","entry":{"customType":"piwright:subagents","data":{"kind":"completed","id":"sa-1"}}}\n')
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === 'turn_end')).toBe(true)
    })
    expect(statuses[statuses.length - 1]?.state).toBe('ready')
    expect(statuses[statuses.length - 1]?.dot).toBe('idle')
    host.dispose()
  })

  it('late agent_settled after deferred turn_end resolution emits no duplicate turn_end', async () => {
    const child = new ScriptedChild((type) => {
      if (type === 'get_state') return handshakeData('C:\\proj\\.pi\\sessions\\a.jsonl')
      if (type === 'get_available_models') return { models: [] }
      if (type === 'get_commands') return { commands: [] }
      if (type === 'get_available_thinking_levels') return { levels: ['off'] }
      if (type === 'get_session_stats') return { tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }
      if (type === 'prompt') {
        queueMicrotask(() => {
          child?.emitData(
            '{"type":"agent_start"}\n' +
              '{"type":"tool_execution_start","toolCallId":"t1","toolName":"Agent","args":{},"parentToolCallId":null}\n' +
              '{"type":"agent_settled","aborted":false}\n'
          )
        })
        return { disposition: 'started' }
      }
      return null
    })
    currentChild = child
    const { host, events, statuses } = makeHost([child], SETTINGS, { subagentGraceMs: 20 })
    await host.prompt('go')
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === 'turn_end')).toBe(true)
    })
    // Запоздалый agent_end/agent_settled после разрешения — без нового agent_start.
    child.emitData('{"type":"agent_end"}\n{"type":"agent_settled","aborted":false}\n')
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(events.filter((e) => e.type === 'turn_end')).toHaveLength(1)
    expect(statuses[statuses.length - 1]?.state).toBe('ready')
    host.dispose()
  })

  it('markCheckTurn tags the next turn_end with check:true', async () => {
    const child = new ScriptedChild((type) => {
      if (type === 'get_state') return handshakeData('C:\\proj\\.pi\\sessions\\a.jsonl')
      if (type === 'get_available_models') return { models: [] }
      if (type === 'get_commands') return { commands: [] }
      if (type === 'get_available_thinking_levels') return { levels: ['off'] }
      if (type === 'get_session_stats') return { tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }
      if (type === 'prompt') {
        queueMicrotask(() => {
          child?.emitData('{"type":"agent_start"}\n{"type":"agent_end"}\n')
        })
        return { disposition: 'started' }
      }
      return null
    })
    currentChild = child
    const { host, events } = makeHost([child])
    host.markCheckTurn()
    await host.prompt('check exit condition')
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === 'turn_end' && (e as { check?: boolean }).check === true)).toBe(true)
    })
    // Флаг одноразовый: следующий обычный ход — обычный turn_end.
    await host.prompt('normal turn')
    await vi.waitFor(() => {
      expect(events.filter((e) => e.type === 'turn_end')).toHaveLength(2)
    })
    const last = events.filter((e) => e.type === 'turn_end')[1] as { check?: boolean }
    expect(last.check).toBeUndefined()
    host.dispose()
  })

  it('turn with the Agent tool but no subagent activity waits the grace window, then resolves', async () => {
    const child = new ScriptedChild((type) => {
      if (type === 'get_state') return handshakeData('C:\\proj\\.pi\\sessions\\a.jsonl')
      if (type === 'get_available_models') return { models: [] }
      if (type === 'get_commands') return { commands: [] }
      if (type === 'get_available_thinking_levels') return { levels: ['off'] }
      if (type === 'get_session_stats') return { tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }
      if (type === 'prompt') {
        queueMicrotask(() => {
          child?.emitData(
            '{"type":"agent_start"}\n' +
              '{"type":"tool_execution_start","toolCallId":"t1","toolName":"Agent","args":{},"parentToolCallId":null}\n' +
              '{"type":"agent_settled","aborted":false}\n'
          )
        })
        return { disposition: 'started' }
      }
      return null
    })
    currentChild = child
    const { host, events, statuses } = makeHost([child], SETTINGS, { subagentGraceMs: 20 })
    await host.prompt('go')
    await vi.waitFor(() => {
      expect(statuses[statuses.length - 1]?.state).toBe('waiting')
    })
    expect(events.some((e) => e.type === 'turn_end')).toBe(false)
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === 'turn_end')).toBe(true)
    })
    expect(statuses[statuses.length - 1]?.state).toBe('ready')
    host.dispose()
  })

  it('subagent completion waits for the nudge turn — single turn_end with notification', async () => {
    const child = new ScriptedChild((type) => {
      if (type === 'get_state') return handshakeData('C:\\proj\\.pi\\sessions\\a.jsonl')
      if (type === 'get_available_models') return { models: [] }
      if (type === 'get_commands') return { commands: [] }
      if (type === 'get_available_thinking_levels') return { levels: ['off'] }
      if (type === 'get_session_stats') return { tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }
      if (type === 'prompt') {
        queueMicrotask(() => {
          child?.emitData(
            '{"type":"agent_start"}\n' +
              '{"type":"tool_execution_start","toolCallId":"t1","toolName":"Agent","args":{},"parentToolCallId":null}\n' +
              '{"type":"entry_appended","entry":{"customType":"piwright:subagents","data":{"kind":"started","id":"sa-1"}}}\n' +
              '{"type":"agent_settled","aborted":false}\n'
          )
        })
        return { disposition: 'started' }
      }
      return null
    })
    currentChild = child
    const { host, events, statuses } = makeHost([child], SETTINGS, { subagentGraceMs: 30 })
    await host.prompt('go')
    await vi.waitFor(() => {
      expect(statuses[statuses.length - 1]?.state).toBe('waiting')
    })
    // Субагент завершился — pi-subagents сразу шлёт nudge (внешний ход-резюме)
    child.emitData('{"type":"entry_appended","entry":{"customType":"piwright:subagents","data":{"kind":"completed","id":"sa-1"}}}\n')
    await new Promise((resolve) => setTimeout(resolve, 10))
    child.emitData('{"type":"agent_start"}\n')
    child.emitData('{"type":"agent_settled","aborted":false}\n')
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === 'turn_end')).toBe(true)
    })
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect(events.filter((e) => e.type === 'turn_end')).toHaveLength(1)
    expect(statuses[statuses.length - 1]?.state).toBe('ready')
    host.dispose()
  })

  it('duplicate agent_end/agent_settled emits a single turn_end', async () => {
    const child = new ScriptedChild((type) => {
      if (type === 'get_state') return handshakeData('C:\\proj\\.pi\\sessions\\a.jsonl')
      if (type === 'get_available_models') return { models: [] }
      if (type === 'get_commands') return { commands: [] }
      if (type === 'get_available_thinking_levels') return { levels: ['off'] }
      if (type === 'get_session_stats') return { tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }
      if (type === 'prompt') {
        queueMicrotask(() => {
          child?.emitData(
            '{"type":"agent_start"}\n' +
              '{"type":"agent_end"}\n' +
              '{"type":"agent_settled","aborted":false}\n'
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
      expect(events.some((e) => e.type === 'turn_end')).toBe(true)
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(events.filter((e) => e.type === 'turn_end')).toHaveLength(1)
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
    expect(result.cleared).toEqual({ steering: ['stop that'], followUp: [] })
    await vi.waitFor(() => {
      expect(events.some((e) => e.type === 'queue_update' && e.steering.length === 0 && e.followUp.length === 0)).toBe(true)
    })
    const types = child.sent.map((c) => c['type'])
    expect(types.indexOf('clear_queue')).toBeGreaterThanOrEqual(0)
    expect(types.indexOf('abort')).toBeGreaterThan(types.indexOf('clear_queue'))
    host.dispose()
  })

  it('seed catalog is visible before start; setModel before start applies right after handshake', async () => {
    const child = new ScriptedChild((type) => {
      if (type === 'get_state') return handshakeData('C:\\proj\\.pi\\sessions\\a.jsonl')
      if (type === 'get_available_models') {
        return { models: [{ provider: 'p', id: 'm2', name: 'm2', contextWindow: 1000, reasoning: true, input: ['text'] }] }
      }
      if (type === 'get_commands') return { commands: [] }
      if (type === 'get_available_thinking_levels') return { levels: ['off', 'low'] }
      return null
    })
    currentChild = child
    const { host, statuses } = makeHost([child], SETTINGS, {
      seedModels: [{ provider: 'p', id: 'm', name: 'm', contextWindow: 1000, imageInput: false, thinkingLevels: ['off', 'low'] }],
      seedThinkingLevels: ['off', 'low']
    })
    const idle = host.lastStatus()
    expect(idle?.state).toBe('idle')
    expect(idle?.models.length).toBe(1)
    expect(idle?.thinkingLevels).toEqual(['off', 'low'])
    const picked = await host.setModel('p/m2')
    expect(picked.ok).toBe(true)
    expect(statuses[statuses.length - 1]?.model).toBe('p/m2')
    await host.prompt('go')
    expect(child.sent.some((c) => c['type'] === 'set_model' && c['provider'] === 'p' && c['modelId'] === 'm2')).toBe(true)
    await vi.waitFor(() => {
      expect(statuses.some((s) => s.state === 'ready' && s.model === 'p/m2')).toBe(true)
    })
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

  it('setThinkingLevel before start updates desired level and pushes status without spawning pi', async () => {
    const child = new ScriptedChild(() => null)
    currentChild = child
    const { host, statuses, spawnArgs } = makeHost([child], SETTINGS, {
      seedModels: [{ provider: 'p', id: 'm', name: 'm', contextWindow: 1000, imageInput: false, thinkingLevels: ['off', 'low'] }],
      seedThinkingLevels: ['off', 'low']
    })
    const result = await host.setThinkingLevel('low')
    expect(result.ok).toBe(true)
    expect(spawnArgs.length).toBe(0)
    expect(statuses[statuses.length - 1]?.thinkingLevel).toBe('low')
    host.dispose()
  })

  it('initialModel/initialThinkingLevel apply after handshake; unknown model is skipped', async () => {
    const child = new ScriptedChild((type) => {
      if (type === 'get_state') return handshakeData('C:\proj\.pi\sessions\a.jsonl')
      if (type === 'get_available_models') {
        return {
          models: [
            { provider: 'p', id: 'm', name: 'm', contextWindow: 1000, reasoning: true, input: ['text'] },
            { provider: 'p', id: 'm2', name: 'm2', contextWindow: 1000, reasoning: true, input: ['text'] }
          ]
        }
      }
      if (type === 'get_commands') return { commands: [] }
      if (type === 'get_available_thinking_levels') return { levels: ['off', 'low'] }
      return null
    })
    currentChild = child
    const { host, statuses } = makeHost([child], SETTINGS, {
      initialModel: 'p/m2',
      initialThinkingLevel: 'low'
    })
    expect(host.lastStatus()?.model).toBe('p/m2')
    expect(host.lastStatus()?.thinkingLevel).toBe('low')
    await host.prompt('go')
    expect(child.sent.some((c) => c['type'] === 'set_model' && c['provider'] === 'p' && c['modelId'] === 'm2')).toBe(true)
    await vi.waitFor(() => {
      expect(statuses.some((s) => s.state === 'ready' && s.model === 'p/m2')).toBe(true)
    })
    host.dispose()

    const unknown = new ScriptedChild((type) => {
      if (type === 'get_state') return handshakeData('C:\proj\.pi\sessions\b.jsonl')
      if (type === 'get_available_models') {
        return { models: [{ provider: 'p', id: 'm', name: 'm', contextWindow: 1000, reasoning: true, input: ['text'] }] }
      }
      if (type === 'get_commands') return { commands: [] }
      if (type === 'get_available_thinking_levels') return { levels: ['off'] }
      return null
    })
    currentChild = unknown
    const second = makeHost([unknown], SETTINGS, { initialModel: 'x/y' })
    await second.host.prompt('go')
    expect(unknown.sent.some((c) => c['type'] === 'set_model')).toBe(false)
    second.host.dispose()
  })

  it('prompt with behavior sends steer/follow_up during the turn and prompt when idle', async () => {
    const child = new ScriptedChild((type) => {
      if (type === 'get_state') return handshakeData('C:\\proj\\.pi\\sessions\\a.jsonl')
      if (type === 'get_available_models') return { models: [] }
      if (type === 'get_commands') return { commands: [] }
      if (type === 'get_available_thinking_levels') return { levels: ['off'] }
      if (type === 'prompt') {
        queueMicrotask(() => {
          currentChild?.emitData('{"type":"agent_start"}\n')
        })
        return { disposition: 'started' }
      }
      if (type === 'steer' || type === 'follow_up') return { disposition: 'queued' }
      return null
    })
    currentChild = child
    const { host, statuses } = makeHost([child])
    await host.prompt('go')
    await vi.waitFor(() => {
      expect(statuses.some((s) => s.state === 'streaming')).toBe(true)
    })
    const steerResult = await host.prompt('fix course', [], 'steer')
    expect(steerResult.ok).toBe(true)
    expect(child.sent.some((c) => c['type'] === 'steer' && c['message'] === 'fix course')).toBe(true)
    const followResult = await host.prompt('after that', [], 'followUp')
    expect(followResult.ok).toBe(true)
    expect(child.sent.some((c) => c['type'] === 'follow_up' && c['message'] === 'after that')).toBe(true)
    child.emitData('{"type":"agent_settled","aborted":false}\n')
    await vi.waitFor(() => {
      expect(statuses[statuses.length - 1].state === 'ready' || statuses[statuses.length - 1].state === 'idle').toBe(true)
    })
    await host.prompt('next', [], 'steer')
    const promptFrames = child.sent.filter((c) => c['type'] === 'prompt')
    expect(promptFrames.some((c) => c['message'] === 'next')).toBe(true)
    host.dispose()
  })

  it('queueClear returns the queued texts', async () => {
    const child = new ScriptedChild((type) => {
      if (type === 'get_state') return handshakeData('C:\\proj\\.pi\\sessions\\a.jsonl')
      if (type === 'get_available_models') return { models: [] }
      if (type === 'get_commands') return { commands: [] }
      if (type === 'get_available_thinking_levels') return { levels: ['off'] }
      if (type === 'clear_queue') return { steering: ['one'], followUp: ['two'] }
      return null
    })
    currentChild = child
    const { host } = makeHost([child])
    await host.prompt('go')
    const result = await host.queueClear()
    expect(result.ok).toBe(true)
    expect(result.cleared).toEqual({ steering: ['one'], followUp: ['two'] })
    expect(child.sent.some((c) => c['type'] === 'clear_queue')).toBe(true)
    host.dispose()
  })

  it('queueRemove re-queues the rest while streaming and drops the picked item', async () => {
    const child = new ScriptedChild((type) => {
      if (type === 'get_state') return handshakeData('C:\\proj\\.pi\\sessions\\a.jsonl')
      if (type === 'get_available_models') return { models: [] }
      if (type === 'get_commands') return { commands: [] }
      if (type === 'get_available_thinking_levels') return { levels: ['off'] }
      if (type === 'prompt') {
        queueMicrotask(() => {
          currentChild?.emitData('{"type":"agent_start"}\n')
        })
        return { disposition: 'started' }
      }
      if (type === 'clear_queue') return { steering: ['a', 'b'], followUp: ['c'] }
      if (type === 'steer' || type === 'follow_up') return { disposition: 'queued' }
      return null
    })
    currentChild = child
    const { host, statuses } = makeHost([child])
    await host.prompt('go')
    await vi.waitFor(() => {
      expect(statuses.some((s) => s.state === 'streaming')).toBe(true)
    })
    const result = await host.queueRemove('steering', 0)
    expect(result.ok).toBe(true)
    expect(result.cleared).toEqual({ steering: [], followUp: [] })
    expect(child.sent.some((c) => c['type'] === 'steer' && c['message'] === 'b')).toBe(true)
    expect(child.sent.some((c) => c['type'] === 'follow_up' && c['message'] === 'c')).toBe(true)
    expect(child.sent.some((c) => c['type'] === 'steer' && c['message'] === 'a')).toBe(false)
    host.dispose()
  })

  it('editPrompt forks the session at the matched prompt and resends the new text', async () => {
    const entries = {
      entries: [
        { id: 'e1', parentId: null, type: 'message', message: { role: 'user', content: 'hello' } },
        { id: 'e2', parentId: 'e1', type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } },
        { id: 'e3', parentId: 'e2', type: 'message', message: { role: 'user', content: 'hello again' } }
      ],
      leafId: 'e3'
    }
    const child = new ScriptedChild((type) => {
      if (type === 'get_state') return handshakeData('C:\\proj\\.pi\\sessions\\branch.jsonl')
      if (type === 'get_available_models') return { models: [] }
      if (type === 'get_commands') return { commands: [] }
      if (type === 'get_available_thinking_levels') return { levels: ['off'] }
      if (type === 'get_entries') return entries
      if (type === 'prompt') {
        queueMicrotask(() => {
          childEmitAgentTurn()
        })
        return { disposition: 'started' }
      }
      return null
    })
    currentChild = child
    const { host, statuses } = makeHost([child])
    await host.prompt('warm up')
    const result = await host.editPrompt('hello', 0, 'edited hello')
    expect(result.ok).toBe(true)
    expect(child.sent.some((c) => c['type'] === 'fork' && c['entryId'] === 'e1')).toBe(true)
    expect(child.sent.some((c) => c['type'] === 'prompt' && c['message'] === 'edited hello')).toBe(true)
    expect(statuses[statuses.length - 1]?.sessionFile).toBe('C:\\proj\\.pi\\sessions\\branch.jsonl')
    host.dispose()
  })

  it('editPrompt matches repeated prompt texts by occurrence from the tail', async () => {
    const entries = {
      entries: [
        { id: 'e1', parentId: null, type: 'message', message: { role: 'user', content: 'same' } },
        { id: 'e2', parentId: 'e1', type: 'message', message: { role: 'assistant', content: 'a' } },
        { id: 'e3', parentId: 'e2', type: 'message', message: { role: 'user', content: 'same' } }
      ],
      leafId: 'e3'
    }
    const child = new ScriptedChild((type) => {
      if (type === 'get_state') return handshakeData('C:\\proj\\.pi\\sessions\\a.jsonl')
      if (type === 'get_available_models') return { models: [] }
      if (type === 'get_commands') return { commands: [] }
      if (type === 'get_available_thinking_levels') return { levels: ['off'] }
      if (type === 'get_entries') return entries
      return null
    })
    currentChild = child
    const { host } = makeHost([child])
    await host.prompt('warm up')
    const last = await host.editPrompt('same', 0, 'x')
    expect(last.ok).toBe(true)
    expect(child.sent.some((c) => c['type'] === 'fork' && c['entryId'] === 'e3')).toBe(true)
    const first = await host.editPrompt('same', 1, 'y')
    expect(first.ok).toBe(true)
    expect(child.sent.some((c) => c['type'] === 'fork' && c['entryId'] === 'e1')).toBe(true)
    host.dispose()
  })

  it('editPrompt fails without fork when the prompt is not in the active branch', async () => {
    const child = new ScriptedChild((type) => {
      if (type === 'get_state') return handshakeData('C:\\proj\\.pi\\sessions\\a.jsonl')
      if (type === 'get_available_models') return { models: [] }
      if (type === 'get_commands') return { commands: [] }
      if (type === 'get_available_thinking_levels') return { levels: ['off'] }
      if (type === 'get_entries') return { entries: [], leafId: null }
      return null
    })
    currentChild = child
    const { host } = makeHost([child])
    await host.prompt('warm up')
    const result = await host.editPrompt('missing', 0, 'x')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('Prompt not found in session history')
    expect(child.sent.some((c) => c['type'] === 'fork')).toBe(false)
    host.dispose()
  })

  it('fork host branches the parent session at the matched prompt before the handshake', async () => {
    const entries = {
      entries: [
        { id: 'e1', parentId: null, type: 'message', message: { role: 'user', content: 'hello' } },
        { id: 'e2', parentId: 'e1', type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } },
        { id: 'e3', parentId: 'e2', type: 'message', message: { role: 'user', content: 'hello again' } }
      ],
      leafId: 'e3'
    }
    const child = new ScriptedChild((type) => {
      if (type === 'get_state') return handshakeData('C:\\proj\\.pi\\sessions\\branch.jsonl')
      if (type === 'get_available_models') return { models: [] }
      if (type === 'get_commands') return { commands: [] }
      if (type === 'get_available_thinking_levels') return { levels: ['off'] }
      if (type === 'get_entries') return entries
      return null
    })
    currentChild = child
    const { host, statuses, spawnArgs } = makeHost([child], SETTINGS, {
      sessionFile: 'C:\\proj\\.pi\\sessions\\parent.jsonl',
      forkSpec: { userText: 'hello again', occurrence: 0 },
      initialSessionName: 'Parent (fork)'
    })
    await host.ensureStarted()
    expect(spawnArgs[0]).toContain('--session')
    const forkIndex = child.sent.findIndex((c) => c['type'] === 'fork')
    const handshakeIndex = child.sent.findIndex((c) => c['type'] === 'get_available_models')
    expect(forkIndex).toBeGreaterThanOrEqual(0)
    expect(forkIndex).toBeLessThan(handshakeIndex)
    expect(child.sent[forkIndex]).toMatchObject({ entryId: 'e3' })
    expect(child.sent.some((c) => c['type'] === 'set_session_name' && c['name'] === 'Parent (fork)')).toBe(true)
    expect(statuses[statuses.length - 1]?.sessionFile).toBe('C:\\proj\\.pi\\sessions\\branch.jsonl')
    expect(statuses[statuses.length - 1]?.title).toBe('Parent (fork)')
    host.dispose()
  })

  it('fork host clones the whole session when there is no following prompt', async () => {
    const child = new ScriptedChild((type) => {
      if (type === 'get_state') return handshakeData('C:\\proj\\.pi\\sessions\\clone.jsonl')
      if (type === 'get_available_models') return { models: [] }
      if (type === 'get_commands') return { commands: [] }
      if (type === 'get_available_thinking_levels') return { levels: ['off'] }
      return null
    })
    currentChild = child
    const { host, statuses } = makeHost([child], SETTINGS, {
      sessionFile: 'C:\\proj\\.pi\\sessions\\parent.jsonl',
      forkSpec: { userText: null, occurrence: 0 }
    })
    await host.ensureStarted()
    expect(child.sent.some((c) => c['type'] === 'clone')).toBe(true)
    expect(child.sent.some((c) => c['type'] === 'fork')).toBe(false)
    expect(statuses[statuses.length - 1]?.sessionFile).toBe('C:\\proj\\.pi\\sessions\\clone.jsonl')
    host.dispose()
  })

  it('fork host fails with an error when the fork point is not in the session', async () => {
    const child = new ScriptedChild((type) => {
      if (type === 'get_state') return handshakeData('C:\\proj\\.pi\\sessions\\a.jsonl')
      if (type === 'get_available_models') return { models: [] }
      if (type === 'get_commands') return { commands: [] }
      if (type === 'get_available_thinking_levels') return { levels: ['off'] }
      if (type === 'get_entries') return { entries: [], leafId: null }
      return null
    })
    currentChild = child
    const { host, statuses } = makeHost([child], SETTINGS, {
      sessionFile: 'C:\\proj\\.pi\\sessions\\parent.jsonl',
      forkSpec: { userText: 'missing', occurrence: 0 }
    })
    await expect(host.ensureStarted()).rejects.toThrow('Prompt not found in session history')
    expect(statuses[statuses.length - 1]?.state).toBe('error')
    host.dispose()
  })

  it('queueRemove when idle returns the remaining texts instead of re-queueing', async () => {
    const child = new ScriptedChild((type) => {
      if (type === 'get_state') return handshakeData('C:\\proj\\.pi\\sessions\\a.jsonl')
      if (type === 'get_available_models') return { models: [] }
      if (type === 'get_commands') return { commands: [] }
      if (type === 'get_available_thinking_levels') return { levels: ['off'] }
      if (type === 'prompt') {
        queueMicrotask(() => {
          childEmitAgentTurn()
        })
        return { disposition: 'started' }
      }
      if (type === 'clear_queue') return { steering: [], followUp: ['left', 'right'] }
      return null
    })
    currentChild = child
    const { host } = makeHost([child])
    await host.prompt('go')
    await vi.waitFor(() => {
      expect(host.streaming).toBe(false)
    })
    const result = await host.queueRemove('followUp', 0)
    expect(result.ok).toBe(true)
    expect(result.cleared).toEqual({ steering: [], followUp: ['right'] })
    expect(child.sent.some((c) => c['type'] === 'steer' || c['type'] === 'follow_up')).toBe(false)
    host.dispose()
  })
})
