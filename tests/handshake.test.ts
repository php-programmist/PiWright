import { describe, expect, it } from 'vitest'
import { runHandshake, supportedThinkingLevels } from '../src/main/pi/handshake'
import type { PiConnection } from '../src/main/pi/connection'
import type { PiJsonObject, PiResponse } from '../src/shared/protocol-types'

function ok(command: string, data: unknown): PiResponse {
  return { id: 'x', command, success: true, data, error: null }
}

/** Заглушка соединения: пишет вызовы, отдаёт скриптованные ответы. */
function scriptedConn(handlers: Record<string, (fields: PiJsonObject | undefined, call: number) => PiResponse>) {
  const calls: string[] = []
  const stub = {
    calls,
    request: async (type: string, fields?: PiJsonObject): Promise<PiResponse> => {
      const call = calls.filter((c) => c === type).length
      calls.push(type)
      const handler = handlers[type]
      if (handler === undefined) return ok(type, null)
      return handler(fields, call)
    }
  }
  return stub as unknown as PiConnection & { calls: string[] }
}

const MODEL = {
  provider: 'p100',
  id: 'qwen3.8-flash-next',
  name: 'qwen3.8',
  contextWindow: 16000,
  reasoning: true,
  input: ['text', 'image'],
  thinkingLevelMap: { off: 'off', medium: 'medium' }
}

describe('runHandshake', () => {
  it('follows the protocol sequence and decodes state', async () => {
    const conn = scriptedConn({
      get_state: (_f, call) =>
        call === 0
          ? ok('get_state', {
              sessionId: 's-1',
              sessionFile: '/home/u/.pi/agent/sessions/x.jsonl',
              model: MODEL,
              thinkingLevel: 'medium',
              autoCompactionEnabled: true
            })
          : ok('get_state', { thinkingLevel: 'medium' }),
      get_available_models: () => ok('get_available_models', { models: [MODEL] }),
      get_commands: () => ok('get_commands', { commands: [{ name: 'compact', description: 'Compact', source: 'core' }] }),
      get_available_thinking_levels: () => ok('get_available_thinking_levels', { levels: ['off', 'medium'] })
    })
    const result = await runHandshake(conn)
    expect(conn.calls).toEqual([
      'get_state',
      'get_available_models',
      'get_commands',
      'get_session_stats',
      'get_available_thinking_levels',
      'get_state'
    ])
    expect(result.sessionId).toBe('s-1')
    expect(result.sessionFile).toBe('/home/u/.pi/agent/sessions/x.jsonl')
    expect(result.model).toMatchObject({ provider: 'p100', id: 'qwen3.8-flash-next', imageInput: true })
    expect(result.models).toHaveLength(1)
    expect(result.commands).toEqual([{ name: 'compact', description: 'Compact', source: 'core' }])
    expect(result.thinkingLevels).toEqual(['off', 'medium'])
    expect(result.thinkingLevel).toBe('medium')
    expect(result.autoCompactionEnabled).toBe(true)
  })

  it('applies desired thinking level only when supported and different', async () => {
    const conn = scriptedConn({
      get_state: (_f, call) =>
        call === 0
          ? ok('get_state', { sessionId: 's', model: MODEL, thinkingLevel: 'off' })
          : ok('get_state', { thinkingLevel: 'off' }),
      get_available_thinking_levels: () => ok('get_available_thinking_levels', { levels: ['off', 'medium'] })
    })
    const result = await runHandshake(conn, { desiredThinkingLevel: 'medium' })
    expect(conn.calls).toContain('set_thinking_level')
    expect(result.thinkingLevel).toBe('medium')
  })

  it('skips set_thinking_level when the level is unknown to the model', async () => {
    const conn = scriptedConn({
      get_state: (_f, call) =>
        call === 0
          ? ok('get_state', { sessionId: 's', model: MODEL, thinkingLevel: 'off' })
          : ok('get_state', { thinkingLevel: 'off' }),
      get_available_thinking_levels: () => ok('get_available_thinking_levels', { levels: ['off', 'medium'] })
    })
    await runHandshake(conn, { desiredThinkingLevel: 'max' })
    expect(conn.calls).not.toContain('set_thinking_level')
  })

  it('sends set_session_name at the end when provided', async () => {
    const conn = scriptedConn({
      get_state: (_f, call) =>
        call === 0
          ? ok('get_state', { sessionId: 's', model: MODEL, thinkingLevel: 'off' })
          : ok('get_state', { thinkingLevel: 'off' }),
      get_available_thinking_levels: () => ok('get_available_thinking_levels', { levels: ['off'] })
    })
    await runHandshake(conn, { sessionName: 'My session' })
    expect(conn.calls[conn.calls.length - 1]).toBe('set_session_name')
  })
})

describe('supportedThinkingLevels', () => {
  it('no reasoning leaves only off', () => {
    expect(supportedThinkingLevels(false, {})).toEqual(['off'])
  })

  it('without a map, xhigh and max require explicit mapping', () => {
    expect(supportedThinkingLevels(true, {})).toEqual(['off', 'minimal', 'low', 'medium', 'high'])
  })

  it('null in the map forbids the level, explicit value allows it', () => {
    expect(supportedThinkingLevels(true, { xhigh: null, max: 'max' })).toEqual([
      'off',
      'minimal',
      'low',
      'medium',
      'high',
      'max'
    ])
  })
})
