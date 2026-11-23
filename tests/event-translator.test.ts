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
  streamSpeeds: { kind: 'thinking' | 'text'; tps: number | null }[] = []
  durations: (number | null)[] = []
  started: { name: string; parent: string | null }[] = []
  ended: { name: string; parent: string | null }[] = []

  onAssistantTextDelta(text: string): void {
    this.text += text
  }
  onThoughtDelta(text: string): void {
    this.thoughts += text
  }
  onStreamSpeed(kind: 'thinking' | 'text', tps: number | null): void {
    this.streamSpeeds.push({ kind, tps })
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
    this.started.push({ name: call.name, parent: call.parentToolCallId })
    this.calls.push(`start:${call.name}:${JSON.stringify(call.args)}`)
  }
  onToolUpdate(id: string, partialText: string): void {
    this.calls.push(`update:${id}:${partialText}`)
  }
  onToolEnd(call: ToolCall, result: ToolResult): void {
    this.ended.push({ name: call.name, parent: call.parentToolCallId })
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
    this.durations.push(usage.durationMs ?? null)
    this.calls.push(
      `result:${usage.inputTokens}/${usage.outputTokens}/${usage.contextTokens ?? 'null'}` +
        `/${usage.cacheReadTokens}+${usage.cacheWriteTokens}/${usage.reasoningTokens ?? 'null'}`
    )
  }
  onError(message: string): void {
    this.calls.push(`error:${message}`)
  }

  onSubagentsActivity(kind: 'started' | 'completed' | 'workflow_started' | 'workflow_settled' | 'disposed', id: string | null): void {
    this.calls.push(`subagents:${kind}:${id ?? 'null'}`)
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

  it('speed averages ttft over messages and divides output by generation windows', () => {
    const recorder = new Recorder()
    const clock = [0, 100, 1_100, 2_100, 2_200, 3_200, 4_200, 5_200].map((ms) => ms * 1e6)
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
    expect(recorder.speeds).toEqual([{ ttftMs: 550, tokensPerSecond: 10 }])
    expect(recorder.streamSpeeds).toEqual([
      { kind: 'thinking', tps: null },
      { kind: 'text', tps: null }
    ])
  })

  it('live stream speed: chars/4 per second, 400 ms throttle, null on kind switch and run end', () => {
    const recorder = new Recorder()
    const clock = [0, 100, 200, 700, 800, 900, 1_400].map((ms) => ms * 1e6)
    let index = 0
    const translator = new PiEventTranslator(recorder, () => clock[index++] ?? 0)
    feed(translator, [
      '{"type":"message_start","message":{"role":"assistant"}}',
      '{"type":"message_update","assistantMessageEvent":{"type":"thinking_delta","delta":"aaaa"}}',
      '{"type":"message_update","assistantMessageEvent":{"type":"thinking_delta","delta":"aaaa"}}',
      '{"type":"message_update","assistantMessageEvent":{"type":"thinking_delta","delta":"aaaa"}}',
      '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"bbbbbbbb"}}',
      '{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"bbbbbbbb"}}',
      '{"type":"tool_execution_start","toolCallId":"t1","toolName":"read","args":{}}'
    ])
    expect(recorder.streamSpeeds).toEqual([
      { kind: 'thinking', tps: 4 },
      { kind: 'thinking', tps: null },
      { kind: 'text', tps: 8 },
      { kind: 'text', tps: null }
    ])
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

  it('nested tool calls carry parentToolCallId', () => {
    const recorder = new Recorder()
    feed(new PiEventTranslator(recorder), [
      '{"type":"tool_execution_start","toolCallId":"p1","toolName":"codemode","args":{}}',
      '{"type":"tool_execution_start","toolCallId":"c1","toolName":"read","args":{"path":"a"},"parentToolCallId":"p1"}',
      '{"type":"tool_execution_end","toolCallId":"c1","toolName":"read","result":{"content":[{"type":"text","text":"x"}]},"isError":false,"parentToolCallId":"p1"}',
      '{"type":"tool_execution_end","toolCallId":"p1","toolName":"codemode","result":{"content":[{"type":"text","text":"done"}]},"isError":false}'
    ])
    expect(recorder.started).toEqual([
      { name: 'codemode', parent: null },
      { name: 'read', parent: 'p1' }
    ])
    expect(recorder.ended).toEqual([
      { name: 'read', parent: 'p1' },
      { name: 'codemode', parent: null }
    ])
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

  it('subagent lifecycle events become subagents_activity', () => {
    const recorder = new Recorder()
    feed(new PiEventTranslator(recorder), [
      '{"type":"subagents:created","id":"a1","description":"x","isBackground":true}',
      '{"type":"subagents:started","id":"a1"}',
      '{"type":"subagents:workflow_started","id":"w1","name":"wf"}',
      '{"type":"subagents:completed","id":"a1"}',
      '{"type":"subagents:failed","id":"a2","error":"boom"}',
      '{"type":"subagents:workflow_settled","id":"w1"}',
      '{"type":"subagents:disposed"}'
    ])
    expect(recorder.calls).toEqual([
      'subagents:started:a1',
      'subagents:started:a1',
      'subagents:workflow_started:w1',
      'subagents:completed:a1',
      'subagents:completed:a2',
      'subagents:workflow_settled:w1',
      'subagents:disposed:null'
    ])
  })

  it('subagent bridge entries (entry_appended) become subagents_activity', () => {
    const recorder = new Recorder()
    feed(new PiEventTranslator(recorder), [
      '{"type":"entry_appended","entry":{"type":"custom","customType":"piwright:subagents","data":{"kind":"started","id":"a1"}}}',
      '{"type":"entry_appended","entry":{"type":"custom","customType":"piwright:subagents","data":{"kind":"completed","id":"a1"}}}',
      '{"type":"entry_appended","entry":{"type":"custom","customType":"piwright:subagents","data":{"kind":"disposed","id":null}}}',
      // чужие custom-entry и entry без customType — игнор
      '{"type":"entry_appended","entry":{"type":"custom","customType":"subagents:record","data":{"kind":"started","id":"x"}}}',
      '{"type":"entry_appended","entry":{"type":"message"}}'
    ])
    expect(recorder.calls).toEqual(['subagents:started:a1', 'subagents:completed:a1', 'subagents:disposed:null'])
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

  it('replay restores turn duration, tokens and tok/s from message timestamps', () => {
    const recorder = new Recorder()
    const messages: unknown[] = [
      { role: 'user', content: 'fix it', timestamp: 1000 },
      {
        role: 'assistant',
        content: [{ type: 'toolCall', id: 't1', name: 'read', arguments: { path: 'a' } }],
        timestamp: 2000,
        durationMs: 500,
        stopReason: 'toolUse',
        usage: { input: 100, output: 10, totalTokens: 200 }
      },
      { role: 'toolResult', toolCallId: 't1', toolName: 'read', content: [{ type: 'text', text: 'x' }], isError: false, timestamp: 2600, durationMs: 100 },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        timestamp: 3000,
        durationMs: 1000,
        stopReason: 'toolUse',
        usage: { input: 150, output: 40, totalTokens: 300 }
      },
      // steering посреди хода (предыдущий ответ кончился toolUse) — не начинает новый ход
      { role: 'user', content: 'also add tests', timestamp: 3500 },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
        timestamp: 4000,
        durationMs: 2000,
        stopReason: 'stop',
        usage: { input: 50, output: 50, totalTokens: 400 }
      },
      // новый ход
      { role: 'user', content: 'one more', timestamp: 10000 },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'sure' }],
        timestamp: 11000,
        durationMs: 500,
        stopReason: 'stop',
        usage: { input: 10, output: 5, totalTokens: 20 }
      }
    ]
    new PiEventTranslator(recorder).replay(messages)
    const results = recorder.calls.filter((c) => c.startsWith('result:'))
    expect(results).toHaveLength(2)
    // Ход 1: 1000 → 4000+2000; usage суммарный; tok/s = 100 out за 3500 мс генерации
    expect(results[0]).toBe('result:300/100/400/0+0/null')
    // Ход 2: 10000 → 11000+500
    expect(results[1]).toBe('result:10/5/20/0+0/null')
    expect(recorder.speeds).toEqual([
      { ttftMs: null, tokensPerSecond: 100 / 3.5 },
      { ttftMs: null, tokensPerSecond: 10 }
    ])
    expect(recorder.durations).toEqual([5000, 1500])
  })

  it('replay without timestamps or usage emits no result rows', () => {
    const recorder = new Recorder()
    const messages: unknown[] = [
      { role: 'user', content: 'fix it' },
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }
    ]
    new PiEventTranslator(recorder).replay(messages)
    expect(recorder.calls).toEqual(['user:fix it'])
    expect(recorder.speeds).toEqual([])
  })

  it('fixture codec still parses every line (guard for the translator fixture)', () => {
    for (const line of fixtureLines()) {
      expect(parseInbound(line), line).not.toBeNull()
    }
  })
})
