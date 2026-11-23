import { describe, expect, it } from 'vitest'
import { estimateContextBreakdown } from '../src/main/pi/context-breakdown'

describe('estimateContextBreakdown', () => {
  it('empty session: null context, zero buckets', () => {
    const b = estimateContextBreakdown([])
    expect(b.contextTokens).toBeNull()
    expect(b.userMessages).toBe(0)
    expect(b.assistantText).toBe(0)
    expect(b.assistantToolCalls).toBe(0)
    expect(b.toolResults).toBe(0)
    expect(b.other).toBe(0)
    expect(b.systemAndTools).toBe(0)
  })

  it('splits assistant text vs tool calls, counts user and toolResult', () => {
    const messages = [
      { role: 'user', content: 'x'.repeat(400) },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'y'.repeat(200) },
          { type: 'thinking', thinking: 'z'.repeat(200) },
          { type: 'toolCall', id: 't1', name: 'read', arguments: { path: '/a/b' } }
        ],
        usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 5000 }
      },
      { role: 'toolResult', toolCallId: 't1', content: [{ type: 'text', text: 'r'.repeat(800) }] }
    ]
    const b = estimateContextBreakdown(messages)
    expect(b.contextTokens).toBe(5000)
    expect(b.userMessages).toBe(100)
    // toolCall: name(4) + JSON args → ceil(≈30/4); text+thinking = 400 chars → 100
    expect(b.assistantText).toBe(100)
    expect(b.assistantToolCalls).toBe(Math.ceil((4 + JSON.stringify({ path: '/a/b' }).length) / 4))
    expect(b.toolResults).toBe(200)
    // residual = 5000 − (100 + 100 + toolCalls + 200)
    const sum = b.userMessages + b.assistantText + b.assistantToolCalls + b.toolResults
    expect(b.systemAndTools).toBe(5000 - sum)
  })

  it('bashExecution, branchSummary, custom go to other', () => {
    const messages = [
      { role: 'bashExecution', command: 'ls', output: 'a'.repeat(400) },
      { role: 'branchSummary', summary: 's'.repeat(200) },
      { role: 'custom', content: 'c'.repeat(80) }
    ]
    const b = estimateContextBreakdown(messages)
    expect(b.other).toBe(Math.ceil(402 / 4) + 50 + 20)
    expect(b.contextTokens).toBeNull()
    expect(b.systemAndTools).toBe(0)
  })

  it('residual never negative', () => {
    const messages = [
      { role: 'user', content: 'x'.repeat(40000) },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'y'.repeat(40000) }],
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 100 }
      }
    ]
    const b = estimateContextBreakdown(messages)
    expect(b.systemAndTools).toBe(0)
  })

  it('last assistant usage wins for contextTokens', () => {
    const messages = [
      {
        role: 'assistant',
        content: [],
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 1000 }
      },
      {
        role: 'assistant',
        content: [],
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2000 }
      }
    ]
    expect(estimateContextBreakdown(messages).contextTokens).toBe(2000)
  })

  it('ignores malformed entries', () => {
    const b = estimateContextBreakdown([null, 'str', 42, { role: 'user', content: 'hi' }])
    expect(b.userMessages).toBe(Math.ceil(2 / 4))
  })
})
