import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { NdjsonAccumulator } from '../src/main/pi/ndjson'
import { parseInbound } from '../src/main/pi/rpc'
import { PiEventTranslator } from '../src/main/pi/event-translator'
import type { StreamListener } from '../src/main/pi/event-translator'
import { compactionSummaryText } from '../src/shared/agent-events'
import type { CompactionEnd, ToolCall, ToolResult, TurnUsage } from '../src/shared/agent-events'
import type { PiJsonObject } from '../src/shared/protocol-types'

/** Порт PiEventTranslatorTest.kt: записанный ход живого pi + синтетические сценарии. */

class Recorder implements StreamListener {
  calls: string[] = []
  text = ''
  thoughts = ''
  results: ToolResult[] = []
  speeds: (TurnUsage['speed'] | null)[] = []

  onAssistantTextDelta(text: string): void {
    this.text += text
  }
  onThoughtDelta(text: string): void {
    this.thoughts += text
  }
  onInjectedUserMessage(text: string): void {
    this.calls.push(`user:${text}`)
  }
  onUserMessage(text: string): void {
    this.calls.push(`live-user:${text}`)
  }
  onQueueUpdate(steering: string[], followUp: string[]): void {
    this.calls.push(`queue:${JSON.stringify(steering)}/${JSON.stringify(followUp)}`)
  }
  onToolStart(call: ToolCall): void {
    this.calls.push(`start:${call.name}:${JSON.stringify(call.args)}`)
  }
  onToolUpdate(id: string, partialText: string): void {
    this.calls.push(`update:${id}:${partialText}`)
  }
  onToolEnd(call: ToolCall, result: ToolResult): void {
    this.calls.push(`end:${call.name}`)
    this.results.push(result)
  }
  onContextUsageUpdate(usage: { used: number; size: number }): void {
    this.calls.push(`ctx:${usage.used}/${usage.size}`)
  }
  onSessionNameChanged(name: string | null): void {
    this.calls.push(`name:${name ?? 'null'}`)
  }
  onNotify(message: string, isError: boolean): void {
    this.calls.push(`notify:${isError}:${message}`)
  }
  onCompactionStart(reason: string): void {
    this.calls.push(`compact-start:${reason}`)
  }
  onCompactionEnd(end: CompactionEnd): void {
    this.calls.push(`compact-end:${JSON.stringify(end)}`)
  }
  onResult(usage: TurnUsage): void {
    this.speeds.push(usage.speed)
    this.calls.push(
      `result:${usage.inputTokens}/${usage.outputTokens}/${usage.contextTokens ?? 'null'}` +
        `/${usage.cacheReadTokens}+${usage.cacheWriteTokens}/${usage.reasoningTokens ?? 'null'}`
    )
  }
  onError(message: string): void {
    this.calls.push(`error:${message}`)
  }
}

function feed(translator: PiEventTranslator, lines: string[]): void {
  for (const line of lines) {
    const o = JSON.parse(line) as PiJsonObject
    translator.onEvent(o['type'] as string, o)
  }
}

function fixtureLines(): string[] {
  const lines: string[] = []
  const acc = new NdjsonAccumulator((l) => lines.push(l))
  acc.append(readFileSync(join(__dirname, 'fixtures', 'pi', 'edit-turn.jsonl'), 'utf8'))
  acc.flush()
  return lines.filter((l) => l.trim().length > 0)
}

describe('PiEventTranslator', () => {
  it('recorded read-then-edit turn from live pi', () => {
    const recorder = new Recorder()
    const translator = new PiEventTranslator(recorder)
    translator.contextWindow = 16000
    feed(translator, fixtureLines())

    expect(recorder.text).toBe('done')
    expect(recorder.thoughts.startsWith('The user wants me to')).toBe(true)
    expect(recorder.calls).toEqual([
      'live-user:Read a.txt, then use the edit tool to replace world with there in a.txt. Then reply done.',
      'ctx:1737/16000',
      'start:read:{"path":"a.txt"}',
      'end:read',
      'ctx:1850/16000',
      'start:edit:{"path":"a.txt","edits":[{"newText":"there","oldText":"world"}]}',
      'end:edit',
      'ctx:1895/16000',
      'result:5291/191/1895/0+0/0'
    ])
    expect(recorder.results[0].text).toBe('hello\nworld\n')
    expect(recorder.results[1].patch).toBe('--- a.txt\n+++ a.txt\n@@ -1,2 +1,2 @@\n hello\n-world\n+there\n')
  })

  it('speed averages ttfb over messages and divides output by generation windows', () => {
    const recorder = new Recorder()
    const clock = [0, 100, 1_100, 2_000, 2_300, 3_300].map((ms) => ms * 1e6)
    let index = 0
    const translator = new PiEventTranslator(recorder, () => clock[index++] ?? 0)
    feed(translator, [
      '{"type":"message_start","message":{"role":"user"}}',
      '{"type":"message_end","message":{"role":"user","content":"hi"}}',
      '{"type":"message_start","message":{"role":"assistant"}}',
      '{"type":"message_update","assistantMessageEvent":{"type":"thinking_start"}}',
      '{"type":"message_update","assistantMessageEvent":{"type":"thinking_delta","delta":"a"}}',
      '{"type":"message_update","assistantMessageEvent":{"type":"toolcall_delta","delta":"b"}}',
      '{"type":"message_end","message":{"role":"assistant","usage":{"output":10}}}',
      '{"type":"message_start","message":{"role":"assistant"}}',
      '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"c"}}',
      '{"type":"message_end","message":{"role":"assistant","usage":{"output":30}}}',
      '{"type":"agent_settled"}'
    ])
    expect(recorder.speeds).toEqual([{ ttfbMs: 200, tokensPerSecond: 20 }])
  })

  it('turn without deltas has no speed', () => {
    const recorder = new Recorder()
    feed(new PiEventTranslator(recorder, () => 0), [
      '{"type":"message_start","message":{"role":"assistant"}}',
      '{"type":"message_end","message":{"role":"assistant","usage":{"output":5}}}',
      '{"type":"agent_settled"}'
    ])
    expect(recorder.speeds).toEqual([null])
    expect(recorder.calls).toEqual(['result:0/5/null/0+0/null'])
  })

  it('queue updates carry both queues, delivered queued message comes as a live user message', () => {
    const recorder = new Recorder()
    feed(new PiEventTranslator(recorder), [
      '{"type":"queue_update","steering":[],"followUp":["Now reply bye."]}',
      '{"type":"queue_update","steering":[],"followUp":[]}',
      '{"type":"message_end","message":{"role":"user","content":[{"type":"text","text":"Now reply bye."}]}}'
    ])
    expect(recorder.calls).toEqual(['queue:[]/["Now reply bye."]', 'queue:[]/[]', 'live-user:Now reply bye.'])
  })

  it('bash partial output passes through as snapshot', () => {
    const recorder = new Recorder()
    feed(new PiEventTranslator(recorder), [
      '{"type":"tool_execution_update","toolCallId":"c1","toolName":"bash","partialResult":{"content":[{"type":"text","text":"line 1"}]}}'
    ])
    expect(recorder.calls).toEqual(['update:c1:line 1'])
  })

  it('model error ends the turn with onError instead of onResult', () => {
    const recorder = new Recorder()
    feed(new PiEventTranslator(recorder), [
      '{"type":"message_end","message":{"role":"assistant","content":[],"stopReason":"error","errorMessage":"429 rate limited"}}',
      '{"type":"agent_settled"}',
      '{"type":"agent_settled"}'
    ])
    expect(recorder.calls).toEqual(['error:429 rate limited', 'result:0/0/null/0+0/null'])
  })

  it('unknown context window skips usage updates but keeps context tokens for the result', () => {
    const recorder = new Recorder()
    feed(new PiEventTranslator(recorder), [
      '{"type":"message_end","message":{"role":"assistant","usage":{"input":10,"output":2,"totalTokens":12},"stopReason":"stop"}}',
      '{"type":"agent_settled"}'
    ])
    expect(recorder.calls).toEqual(['result:10/2/12/0+0/null'])
  })

  it('extension error becomes an error notification', () => {
    const recorder = new Recorder()
    feed(new PiEventTranslator(recorder), ['{"type":"extension_error","error":"boom"}'])
    expect(recorder.calls).toEqual(['notify:true:boom'])
  })

  it('compaction events report outcome and reset context usage to the estimate', () => {
    const recorder = new Recorder()
    const translator = new PiEventTranslator(recorder)
    translator.contextWindow = 100000
    feed(translator, [
      '{"type":"compaction_start","reason":"threshold"}',
      '{"type":"compaction_end","reason":"threshold","result":{"summary":"s","firstKeptEntryId":"e1","tokensBefore":90000,"estimatedTokensAfter":12000,"details":{}},"aborted":false,"willRetry":false}',
      '{"type":"compaction_end","reason":"manual","aborted":true,"willRetry":false}',
      '{"type":"compaction_end","reason":"overflow","aborted":false,"willRetry":false,"errorMessage":"Context overflow recovery failed: boom"}'
    ])
    expect(recorder.calls).toEqual([
      'compact-start:threshold',
      'ctx:12000/100000',
      'compact-end:{"reason":"threshold","tokensBefore":90000,"tokensAfter":12000,"aborted":false,"error":null,"willRetry":false}',
      'compact-end:{"reason":"manual","tokensBefore":null,"tokensAfter":null,"aborted":true,"error":null,"willRetry":false}',
      'compact-end:{"reason":"overflow","tokensBefore":null,"tokensAfter":null,"aborted":false,"error":"Context overflow recovery failed: boom","willRetry":false}'
    ])
  })

  it('cache and reasoning tokens accumulate over the assistant messages of one turn', () => {
    const recorder = new Recorder()
    feed(new PiEventTranslator(recorder), [
      '{"type":"message_end","message":{"role":"assistant","usage":{"input":1000,"output":600,"cacheRead":50000,"cacheWrite":4000,"reasoning":250,"totalTokens":53600},"stopReason":"stop"}}',
      '{"type":"message_end","message":{"role":"assistant","usage":{"input":200,"output":100,"cacheRead":10000,"cacheWrite":0,"totalTokens":10300},"stopReason":"stop"}}',
      '{"type":"agent_settled"}'
    ])
    expect(recorder.calls).toEqual(['result:1200/700/10300/60000+4000/250'])
  })

  it('compaction summary text', () => {
    expect(
      compactionSummaryText({ reason: 'manual', tokensBefore: 90000, tokensAfter: 12000, aborted: false, error: null, willRetry: false })
    ).toBe('Context compacted: 90,000 → ~12,000 tokens')
    expect(
      compactionSummaryText({ reason: 'overflow', tokensBefore: 90000, tokensAfter: 12000, aborted: false, error: null, willRetry: true })
    ).toBe('Context compacted: 90,000 → ~12,000 tokens, retrying the request')
    expect(
      compactionSummaryText({ reason: 'manual', tokensBefore: 5000, tokensAfter: null, aborted: false, error: null, willRetry: false })
    ).toBe('Context compacted: 5,000 tokens')
  })

  it('replay renders user text, thinking, text and matched tool results', () => {
    const recorder = new Recorder()
    const messages: unknown[] = [
      { role: 'system', content: '' },
      { role: 'user', content: [{ type: 'text', text: 'fix it' }] },
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'hmm' },
          { type: 'toolCall', id: 't1', name: 'read', arguments: { path: 'a' } }
        ]
      },
      { role: 'toolResult', toolCallId: 't1', toolName: 'read', content: [{ type: 'text', text: 'x' }], isError: false },
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
      { role: 'user', content: 'plain string' },
      { role: 'compactionSummary', summary: 's', tokensBefore: 5000, timestamp: 1 }
    ]
    new PiEventTranslator(recorder).replay(messages)
    expect(recorder.calls).toEqual([
      'user:fix it',
      'start:read:{"path":"a"}',
      'end:read',
      'user:plain string',
      'compact-end:{"reason":"manual","tokensBefore":5000,"tokensAfter":null,"aborted":false,"error":null,"willRetry":false}'
    ])
    expect(recorder.thoughts).toBe('hmm')
    expect(recorder.text).toBe('ok')
    expect(recorder.results).toHaveLength(1)
    expect(recorder.results[0].text).toBe('x')
  })

  it('fixture codec still parses every line (guard for the translator fixture)', () => {
    for (const line of fixtureLines()) {
      expect(parseInbound(line), line).not.toBeNull()
    }
  })
})
