import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NdjsonAccumulator } from '../src/main/pi/ndjson'
import { parseInbound } from '../src/main/pi/rpc'

/** Живой ход pi из jb-pi: каждая строка обязана разбираться кодеком. */
const fixturePath = join(__dirname, 'fixtures', 'pi', 'edit-turn.jsonl')

function fixtureLines(): string[] {
  const lines: string[] = []
  const acc = new NdjsonAccumulator((l) => lines.push(l))
  acc.append(readFileSync(fixturePath, 'utf8'))
  acc.flush()
  return lines
}

describe('edit-turn.jsonl fixture', () => {
  it('every line parses to an inbound message', () => {
    const lines = fixtureLines()
    expect(lines.length).toBeGreaterThan(100)
    for (const line of lines) {
      expect(parseInbound(line), line).not.toBeNull()
    }
  })

  it('contains the documented event kinds', () => {
    const kinds = new Set<string>()
    for (const line of fixtureLines()) {
      const msg = parseInbound(line)
      if (msg?.kind === 'event') kinds.add(msg.type)
    }
    expect(kinds.has('agent_start')).toBe(true)
    expect(kinds.has('message_update')).toBe(true)
    expect(kinds.has('agent_settled')).toBe(true)
  })

  it('message_update carries text deltas for the assistant reply', () => {
    let text = ''
    for (const line of fixtureLines()) {
      const msg = parseInbound(line)
      if (msg?.kind !== 'event' || msg.type !== 'message_update') continue
      const raw = msg.payload['assistantMessageEvent'] as Record<string, unknown> | undefined
      if (raw && raw['type'] === 'text_delta' && typeof raw['delta'] === 'string') text += raw['delta']
    }
    expect(text).toBe('done')
  })
})
