import { describe, expect, it } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import { SessionHost } from '../src/main/pi/session-host'
import type { SessionHostListener } from '../src/main/pi/session-host'
import type { PiBackend } from '../src/main/pi/backends/types'
import type { CreateBackendResult } from '../src/main/pi/backends/factory'
import type { PiStatus, Settings } from '../src/shared/ipc-contracts'
import { DEFAULT_SETTINGS } from '../src/main/settings/settings'
import type { UiEvent } from '../src/shared/agent-events'
import { ScriptedChild } from './helpers/fake-child'
import { buildTitlePrompt, cleanSessionTitle, fallbackTitle, truncateTitleMessage } from '../src/main/pi/session-title'

const SETTINGS: Settings = { ...DEFAULT_SETTINGS }
const PROJECT = { kind: 'native' as const, dir: 'C:\\proj' }
const SESSION_FILE = 'C:\\proj\\.pi\\sessions\\a.jsonl'

function handshakeData(sessionFile: string): Record<string, unknown> {
  return {
    sessionId: 's-1',
    sessionFile,
    model: { provider: 'p', id: 'm', name: 'm', contextWindow: 1000, reasoning: true, input: ['text'] },
    thinkingLevel: 'off',
    autoCompactionEnabled: false
  }
}

function agentTurnOn(child: ScriptedChild, text: string): void {
  child.emitData(
    `{"type":"message_update","assistantMessageEvent":{"type":"text_delta","contentIndex":1,"delta":${JSON.stringify(text)}}}\n`
  )
  child.emitData('{"type":"agent_settled","aborted":false}\n')
}

function realChild(): ScriptedChild {
  const child = new ScriptedChild((type) => {
    if (type === 'get_state') return handshakeData(SESSION_FILE)
    if (type === 'get_available_models') return { models: [] }
    if (type === 'get_commands') return { commands: [] }
    if (type === 'get_session_stats') return { tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }
    if (type === 'get_available_thinking_levels') return { levels: ['off'] }
    if (type === 'prompt') {
      queueMicrotask(() => agentTurnOn(child, 'pong'))
      return { disposition: 'started' }
    }
    return null
  })
  return child
}

function titleChild(title: string | null): ScriptedChild {
  const child = new ScriptedChild((type) => {
    if (type === 'get_state') return handshakeData('C:\\proj\\.pi\\sessions\\title.jsonl')
    if (type === 'prompt') {
      queueMicrotask(() => {
        if (title !== null) agentTurnOn(child, title)
        else child.emitData('{"type":"agent_settled","aborted":false}\n')
      })
      return { disposition: 'started' }
    }
    return null
  })
  return child
}

function makeHost(children: ScriptedChild[]): {
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
  const host = new SessionHost(() => SETTINGS, listener, PROJECT, {
    createBackend: async () => created,
    installExtensions: async () => []
  })
  return { host, events, statuses, spawnArgs }
}

const TITLE_ARGS = ['--mode', 'rpc', '--no-session', '--no-extensions', '--no-tools', '--no-mcp']

describe('session title generation', () => {
  it('buildTitlePrompt keeps rules and truncates long messages', () => {
    const prompt = buildTitlePrompt('почини логин')
    expect(prompt).toContain('2-3 words')
    expect(prompt).toContain('почини логин')
    expect(truncateTitleMessage('x'.repeat(3000))).toHaveLength(2001)
    expect(truncateTitleMessage('short')).toBe('short')
  })

  it('cleanSessionTitle strips fences, quotes and extra lines', () => {
    expect(cleanSessionTitle('```\nFix Login Bug\n```')).toBe('Fix Login Bug')
    expect(cleanSessionTitle('"Починить вход"')).toBe('Починить вход')
    expect(cleanSessionTitle('Fix Login\n\nsecond line')).toBe('Fix Login')
    expect(cleanSessionTitle('   ')).toBe('')
    expect(cleanSessionTitle('x'.repeat(100))).toHaveLength(60)
  })

  it('cleanSessionTitle rejects tool-call markup', () => {
    expect(cleanSessionTitle('<tool_call>')).toBe('')
    expect(cleanSessionTitle('<invoke name="read">')).toBe('')
    expect(cleanSessionTitle('Fix <parameter=name>Login</parameter>')).toBe('')
  })

  it('fallbackTitle takes first 3 words capped at 20 chars', () => {
    expect(fallbackTitle('почини логин пожалуйста скорее')).toBe('почини логин пожалуй')
    expect(fallbackTitle('Fix the authentication token expiry check')).toBe('Fix the authenticati')
    expect(fallbackTitle('  spaced   out   words  ')).toBe('spaced out words')
    expect(fallbackTitle('   ')).toBe('')
  })

  it('first prompt generates a title via one-shot pi and renames before sending the prompt', async () => {
    const real = realChild()
    const title = titleChild('Fix login bug')
    const { host, events, spawnArgs } = makeHost([real, title])

    const result = await host.prompt('please fix the login bug')
    expect(result.ok).toBe(true)

    expect(spawnArgs).toHaveLength(2)
    expect(spawnArgs[1]).toEqual(TITLE_ARGS)

    const titleCommands = title.sent.map((c) => String(c['type']))
    expect(titleCommands).toEqual(['get_state', 'set_model', 'prompt'])
    const setModel = title.sent[1]
    expect(setModel['provider']).toBe('p')
    expect(setModel['modelId']).toBe('m')

    const realCommands = real.sent.map((c) => String(c['type']))
    const nameIndex = realCommands.indexOf('set_session_name')
    const promptIndex = realCommands.indexOf('prompt')
    expect(nameIndex).toBeGreaterThanOrEqual(0)
    expect(promptIndex).toBeGreaterThan(nameIndex)
    expect(real.sent[nameIndex]['name']).toBe('Fix login bug')
    expect(events.some((e) => e.type === 'session_name' && e.name === 'Fix login bug')).toBe(true)
    host.dispose()
  })

  it('empty title answer falls back to the first words of the message', async () => {
    const real = realChild()
    const title = titleChild(null)
    const { host, spawnArgs } = makeHost([real, title])

    const result = await host.prompt('hello there')
    expect(result.ok).toBe(true)
    expect(spawnArgs).toHaveLength(2)
    const rename = real.sent.find((c) => String(c['type']) === 'set_session_name')
    expect(rename?.['name']).toBe('hello there')
    expect(real.sent.some((c) => String(c['type']) === 'prompt')).toBe(true)
    host.dispose()
  })

  it('tool-call markup answer falls back to the first words of the message', async () => {
    const real = realChild()
    const title = titleChild('<tool_call>')
    const { host } = makeHost([real, title])

    const result = await host.prompt('Fix the authentication token expiry check')
    expect(result.ok).toBe(true)
    const rename = real.sent.find((c) => String(c['type']) === 'set_session_name')
    expect(rename?.['name']).toBe('Fix the authenticati')
    host.dispose()
  })

  it('manually renamed session skips title generation', async () => {
    const real = realChild()
    const { host, spawnArgs } = makeHost([real])

    await host.rename('Mine')
    const result = await host.prompt('hello there')
    expect(result.ok).toBe(true)
    expect(spawnArgs).toHaveLength(1)
    host.dispose()
  })

  it('second prompt does not regenerate the title', async () => {
    const real = realChild()
    const title = titleChild('Fix login bug')
    const { host, spawnArgs } = makeHost([real, title])

    await host.prompt('please fix the login bug')
    await host.prompt('second message')
    expect(spawnArgs).toHaveLength(2)
    expect(real.sent.filter((c) => String(c['type']) === 'set_session_name')).toHaveLength(1)
    host.dispose()
  })
})
