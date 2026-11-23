import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NdjsonAccumulator } from '../src/main/pi/ndjson'
import { PiEventTranslator } from '../src/main/pi/event-translator'
import type { StreamListener } from '../src/main/pi/event-translator'
import { useChatStore } from '../src/renderer/src/stores/chat'
import type { Entry } from '../src/renderer/src/stores/chat'
import type { UiEvent } from '../src/shared/agent-events'

/** Редьюсер транскрипта: дельты с троттлингом, инструменты, эхо, диалоги, изоляция сессий. */

const HOST = 'host-1'

function translateFixture(): UiEvent[] {
  const lines: string[] = []
  const acc = new NdjsonAccumulator((l) => lines.push(l))
  acc.append(readFileSync(join(__dirname, 'fixtures', 'pi', 'edit-turn.jsonl'), 'utf8'))
  acc.flush()
  const events: UiEvent[] = []
  const listener: StreamListener = {
    onAssistantTextDelta: (text) => events.push({ type: 'assistant_delta', text }),
    onThoughtDelta: (text) => events.push({ type: 'thought_delta', text }),
    onInjectedUserMessage: (text) => events.push({ type: 'injected_user_message', text }),
    onUserMessage: (text) => events.push({ type: 'user_message', text }),
    onQueueUpdate: (steering, followUp) => events.push({ type: 'queue_update', steering, followUp }),
    onToolStart: (call) => events.push({ type: 'tool_start', call }),
    onToolUpdate: (id, text) => events.push({ type: 'tool_update', id, text }),
    onToolEnd: (call, result) => events.push({ type: 'tool_end', call, result }),
    onContextUsageUpdate: (usage) => events.push({ type: 'context_usage', used: usage.used, size: usage.size }),
    onSessionNameChanged: (name) => events.push({ type: 'session_name', name }),
    onNotify: (message, isError) => events.push({ type: 'notify', message, isError }),
    onCompactionStart: (reason) => events.push({ type: 'compaction_start', reason }),
    onCompactionEnd: (end) => events.push({ type: 'compaction_end', end }),
    onResult: (usage) => events.push({ type: 'turn_result', usage }),
    onError: (message) => events.push({ type: 'turn_error', message }),
    onStreamSpeed: () => {},
    onSubagentsActivity: () => {}
  }
  const translator = new PiEventTranslator(listener)
  translator.contextWindow = 16000
  events.push({ type: 'turn_start' })
  for (const line of lines.filter((l) => l.trim().length > 0)) {
    const o = JSON.parse(line) as Record<string, unknown>
    translator.onEvent(o['type'] as string, o)
  }
  events.push({ type: 'turn_end' })
  return events
}

describe('chat store transcript', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useChatStore.getState().resetTranscript(HOST)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function entries(): Entry[] {
    return useChatStore.getState().hosts[HOST]?.entries ?? []
  }

  it('deltas are throttled into one text entry', () => {
    const store = useChatStore.getState()
    store.applyEvent({ hostId: HOST, event: { type: 'turn_start' } })
    store.applyEvent({ hostId: HOST, event: { type: 'assistant_delta', text: 'he' } })
    store.applyEvent({ hostId: HOST, event: { type: 'assistant_delta', text: 'llo' } })
    expect(entries()).toEqual([])
    vi.advanceTimersByTime(200)
    expect(entries()).toEqual([{ kind: 'text', id: expect.any(Number), text: 'hello', open: true }])
    store.applyEvent({ hostId: HOST, event: { type: 'turn_end' } })
    expect(entries()[0]).toMatchObject({ text: 'hello', open: false })
    expect(useChatStore.getState().hosts[HOST]?.streaming).toBe(false)
  })

  it('stream speed feeds the timer and the open thinking entry, kind-aware', () => {
    const store = useChatStore.getState()
    store.applyEvent({ hostId: HOST, event: { type: 'turn_start' } })
    store.applyEvent({ hostId: HOST, event: { type: 'thought_delta', text: 'hmm' } })
    vi.advanceTimersByTime(200)
    store.applyEvent({ hostId: HOST, event: { type: 'stream_speed', kind: 'thinking', tps: 42.4 } })
    expect(useChatStore.getState().hosts[HOST]?.streamTps).toBe(42.4)
    expect(entries()[0]).toMatchObject({ kind: 'thinking', open: true, tps: 42.4 })
    store.applyEvent({ hostId: HOST, event: { type: 'stream_speed', kind: 'thinking', tps: null } })
    expect(useChatStore.getState().hosts[HOST]?.streamTps).toBeNull()
    expect(entries()[0]).toMatchObject({ tps: null })
    store.applyEvent({ hostId: HOST, event: { type: 'stream_speed', kind: 'text', tps: 30 } })
    expect(useChatStore.getState().hosts[HOST]?.streamTps).toBe(30)
    expect(entries()[0]).toMatchObject({ tps: null })
    store.applyEvent({ hostId: HOST, event: { type: 'turn_end' } })
    expect(useChatStore.getState().hosts[HOST]?.streamTps).toBeNull()
  })

  it('non-delta events flush pending deltas first', () => {
    const store = useChatStore.getState()
    store.applyEvent({ hostId: HOST, event: { type: 'turn_start' } })
    store.applyEvent({ hostId: HOST, event: { type: 'assistant_delta', text: 'partial' } })
    store.applyEvent({ hostId: HOST, event: { type: 'tool_start', call: { id: 'c1', name: 'bash', args: { command: 'ls' }, parentToolCallId: null } } })
    const list = entries()
    expect(list[0]).toMatchObject({ kind: 'text', text: 'partial', open: false })
    expect(list[1]).toMatchObject({ kind: 'tool', call: { id: 'c1' }, result: null })
  })

  it('tool update and end fill the matching block', () => {
    const store = useChatStore.getState()
    store.applyEvent({ hostId: HOST, event: { type: 'tool_start', call: { id: 'c1', name: 'bash', args: {}, parentToolCallId: null } } })
    store.applyEvent({ hostId: HOST, event: { type: 'tool_update', id: 'c1', text: 'line 1' } })
    expect(entries()[0]).toMatchObject({ partial: 'line 1' })
    store.applyEvent({ hostId: HOST, event: { type: 'tool_end', call: { id: 'c1', name: 'bash', args: {}, parentToolCallId: null }, result: { text: 'line 1\nline 2', isError: false, patch: null } } })
    expect(entries()[0]).toMatchObject({ result: { text: 'line 1\nline 2' } })
  })

  it('nested tool calls attach to the parent block and update in place', () => {
    const store = useChatStore.getState()
    store.applyEvent({ hostId: HOST, event: { type: 'tool_start', call: { id: 'p1', name: 'codemode', args: {}, parentToolCallId: null } } })
    store.applyEvent({ hostId: HOST, event: { type: 'tool_start', call: { id: 'c1', name: 'read', args: {}, parentToolCallId: 'p1' } } })
    store.applyEvent({ hostId: HOST, event: { type: 'tool_start', call: { id: 'c2', name: 'bash', args: {}, parentToolCallId: 'p1' } } })
    const flat = entries()
    expect(flat).toHaveLength(1)
    const parent = flat[0] as Extract<Entry, { kind: 'tool' }>
    expect(parent.call.id).toBe('p1')
    expect(parent.children.map((c) => c.call.id)).toEqual(['c1', 'c2'])
    store.applyEvent({ hostId: HOST, event: { type: 'tool_update', id: 'c1', text: 'partial' } })
    store.applyEvent({ hostId: HOST, event: { type: 'tool_end', call: { id: 'c1', name: 'read', args: {}, parentToolCallId: 'p1' }, result: { text: 'x', isError: false, patch: null } } })
    const after = (entries()[0] as Extract<Entry, { kind: 'tool' }>).children
    expect(after[0]).toMatchObject({ partial: 'partial', result: { text: 'x' } })
    store.applyEvent({ hostId: HOST, event: { type: 'tool_end', call: { id: 'p1', name: 'codemode', args: {}, parentToolCallId: null }, result: { text: 'done', isError: false, patch: null } } })
    expect((entries()[0] as Extract<Entry, { kind: 'tool' }>).result?.text).toBe('done')
  })

  it('session stats replace totals, extension statuses and widgets set and clear', () => {
    const store = useChatStore.getState()
    store.applyEvent({ hostId: HOST, event: { type: 'session_stats', tokens: { input: 100, output: 20, cacheRead: 900, cacheWrite: 30 } } })
    expect(useChatStore.getState().hosts[HOST]?.usageTotals).toEqual({ input: 100, output: 20, cacheRead: 900, cacheWrite: 30 })
    store.applyEvent({ hostId: HOST, event: { type: 'extension_status', key: 'lsp', text: 'LSP: idle' } })
    store.applyEvent({ hostId: HOST, event: { type: 'widget', key: 'pi-agent-desktop:todo', lines: ['{"subject":"a","status":"pending"}'] } })
    expect(useChatStore.getState().hosts[HOST]?.extensionStatuses).toEqual({ lsp: 'LSP: idle' })
    expect(useChatStore.getState().hosts[HOST]?.widgets['pi-agent-desktop:todo']).toHaveLength(1)
    store.applyEvent({ hostId: HOST, event: { type: 'extension_status', key: 'lsp', text: null } })
    store.applyEvent({ hostId: HOST, event: { type: 'widget', key: 'pi-agent-desktop:todo', lines: null } })
    expect(useChatStore.getState().hosts[HOST]?.extensionStatuses).toEqual({})
    expect(useChatStore.getState().hosts[HOST]?.widgets['pi-agent-desktop:todo']).toBeUndefined()
  })

  it('own echoes are suppressed, queued deliveries are shown', () => {
    const store = useChatStore.getState()
    store.addUserMessage(HOST, 'hello')
    store.applyEvent({ hostId: HOST, event: { type: 'user_message', text: 'hello' } })
    expect(entries()).toHaveLength(1)
    store.applyEvent({ hostId: HOST, event: { type: 'user_message', text: 'queued follow-up' } })
    expect(entries()).toHaveLength(2)
    expect(entries()[1]).toMatchObject({ kind: 'user', text: 'queued follow-up' })
  })

  it('truncateFrom drops the entry and everything after it, then a new prompt appends', () => {
    const store = useChatStore.getState()
    store.addUserMessage(HOST, 'first')
    store.applyEvent({ hostId: HOST, event: { type: 'injected_user_message', text: 'answer' } })
    store.addUserMessage(HOST, 'second')
    const all = entries()
    expect(all).toHaveLength(3)
    store.truncateFrom(HOST, all[1].id)
    expect(entries()).toEqual([all[0]])
    store.addUserMessage(HOST, 'edited')
    expect(entries()).toHaveLength(2)
    expect(entries()[1]).toMatchObject({ kind: 'user', text: 'edited' })
  })

  it('dialogs open, expire and take receipts', () => {
    const store = useChatStore.getState()
    store.applyEvent({
      hostId: HOST,
      event: { type: 'dialog_open', id: 'u1', dialog: { kind: 'confirm', title: 'Run?', message: null, timeoutMs: null } }
    })
    expect(entries()[0]).toMatchObject({ kind: 'dialog', dialogId: 'u1', receipt: null })
    store.setDialogReceipt(HOST, 'u1', 'answered')
    expect(entries()[0]).toMatchObject({ receipt: 'answered' })
    store.applyEvent({ hostId: HOST, event: { type: 'dialog_expired', id: 'u1' } })
    expect(entries()[0]).toMatchObject({ receipt: 'answered' })
    store.applyEvent({ hostId: HOST, event: { type: 'dialog_open', id: 'u2', dialog: { kind: 'input', title: 'q', placeholder: null, timeoutMs: null } } })
    store.applyEvent({ hostId: HOST, event: { type: 'dialog_expired', id: 'u2' } })
    expect(entries()[1]).toMatchObject({ receipt: 'expired' })
  })

  it('dialog_answered from the other side closes an open card, answered card stays', () => {
    const store = useChatStore.getState()
    store.applyEvent({
      hostId: HOST,
      event: { type: 'dialog_open', id: 'u1', dialog: { kind: 'confirm', title: 'Run?', message: null, timeoutMs: null } }
    })
    store.applyEvent({ hostId: HOST, event: { type: 'dialog_answered', id: 'u1', by: 'phone' } })
    expect(entries()[0]).toMatchObject({ receipt: 'answered' })

    store.applyEvent({
      hostId: HOST,
      event: { type: 'dialog_open', id: 'u2', dialog: { kind: 'confirm', title: 'Run?', message: null, timeoutMs: null } }
    })
    store.setDialogReceipt(HOST, 'u2', 'answered')
    store.applyEvent({ hostId: HOST, event: { type: 'dialog_answered', id: 'u2', by: 'phone' } })
    expect(entries()[1]).toMatchObject({ receipt: 'answered' })
  })

  it('sessions are isolated by hostId', () => {
    const store = useChatStore.getState()
    store.addUserMessage(HOST, 'mine')
    store.addUserMessage('host-2', 'theirs')
    store.applyEvent({ hostId: 'host-2', event: { type: 'assistant_delta', text: 'reply' } })
    expect(entries()).toHaveLength(1)
    expect(useChatStore.getState().hosts['host-2']?.entries).toHaveLength(1)
    store.removeHost('host-2')
    expect(useChatStore.getState().hosts['host-2']).toBeUndefined()
    expect(entries()).toHaveLength(1)
  })

  it('unread flag marks and clears per host', () => {
    const store = useChatStore.getState()
    store.applyEvent({ hostId: HOST, event: { type: 'turn_end' } })
    expect(useChatStore.getState().hosts[HOST]?.unread).toBe(false)
    store.markUnread(HOST)
    expect(useChatStore.getState().hosts[HOST]?.unread).toBe(true)
    store.markUnread(HOST)
    store.markRead(HOST)
    expect(useChatStore.getState().hosts[HOST]?.unread).toBe(false)
    store.markRead(HOST)
    store.markUnread('unknown-host')
    expect(useChatStore.getState().hosts['unknown-host']).toBeUndefined()
  })

  it('turn timer: turnStartedAt set on turn_start, duration attached to result, cleared on turn_end', () => {
    const store = useChatStore.getState()
    store.applyEvent({ hostId: HOST, event: { type: 'turn_start' } })
    expect(useChatStore.getState().hosts[HOST]?.turnStartedAt).toBe(Date.now())
    vi.advanceTimersByTime(5000)
    store.applyEvent({
      hostId: HOST,
      event: {
        type: 'turn_result',
        usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: null, contextTokens: null, speed: null }
      }
    })
    const results = entries().filter((e): e is Extract<Entry, { kind: 'result' }> => e.kind === 'result')
    expect(results[0].durationMs).toBe(5000)
    store.applyEvent({ hostId: HOST, event: { type: 'turn_end' } })
    expect(useChatStore.getState().hosts[HOST]?.turnStartedAt).not.toBeNull()
    expect(useChatStore.getState().hosts[HOST]?.streaming).toBe(false)
  })

  it('turn_end before turn_result (agent_end precedes agent_settled): duration still computed', () => {
    const store = useChatStore.getState()
    store.applyEvent({ hostId: HOST, event: { type: 'turn_start' } })
    vi.advanceTimersByTime(7000)
    store.applyEvent({ hostId: HOST, event: { type: 'turn_end' } })
    store.applyEvent({
      hostId: HOST,
      event: {
        type: 'turn_result',
        usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: null, contextTokens: null, speed: null }
      }
    })
    const results = entries().filter((e): e is Extract<Entry, { kind: 'result' }> => e.kind === 'result')
    expect(results[0].durationMs).toBe(7000)
  })

  it('translated edit-turn fixture builds the full transcript', () => {
    const store = useChatStore.getState()
    for (const event of translateFixture()) store.applyEvent({ hostId: HOST, event })
    const list = entries()
    const kinds = list.map((e) => e.kind)
    expect(kinds[0]).toBe('user')
    const texts = list.filter((e): e is Extract<Entry, { kind: 'text' }> => e.kind === 'text')
    expect(texts.map((t) => t.text).join('')).toBe('done')
    const tools = list.filter((e): e is Extract<Entry, { kind: 'tool' }> => e.kind === 'tool')
    expect(tools.map((t) => t.call.name)).toEqual(['read', 'edit'])
    expect(tools[1].result?.patch).toContain('+there')
    const results = list.filter((e): e is Extract<Entry, { kind: 'result' }> => e.kind === 'result')
    expect(results).toHaveLength(1)
    expect(results[0].usage.contextTokens).toBe(1895)
    expect(useChatStore.getState().hosts[HOST]?.streaming).toBe(false)
  })

  it('replay_batch result keeps durationMs from the event (restored turn timing)', () => {
    const store = useChatStore.getState()
    store.applyEvent({
      hostId: HOST,
      event: {
        type: 'replay_batch',
        events: [
          { type: 'injected_user_message', text: 'q1' },
          { type: 'assistant_delta', text: 'a' },
          {
            type: 'turn_result',
            usage: {
              inputTokens: 10,
              outputTokens: 2,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              reasoningTokens: null,
              contextTokens: 20,
              speed: { ttftMs: null, tokensPerSecond: 4 },
              durationMs: 4200
            }
          }
        ]
      }
    })
    const results = entries().filter((e): e is Extract<Entry, { kind: 'result' }> => e.kind === 'result')
    expect(results).toHaveLength(1)
    expect(results[0].durationMs).toBe(4200)
  })

  it('replay_batch folds history in one applyEvent and marks the host restored', () => {
    const store = useChatStore.getState()
    store.applyEvent({
      hostId: HOST,
      event: {
        type: 'replay_batch',
        events: [
          { type: 'injected_user_message', text: 'q1' },
          { type: 'assistant_delta', text: 'a' },
          { type: 'assistant_delta', text: '1' },
          { type: 'tool_start', call: { id: 'c1', name: 'read', args: {}, parentToolCallId: null } },
          { type: 'tool_end', call: { id: 'c1', name: 'read', args: {}, parentToolCallId: null }, result: { text: 'ok', isError: false, patch: null } }
        ]
      }
    })
    const list = entries()
    expect(list.map((e) => e.kind)).toEqual(['user', 'text', 'tool'])
    expect((list[1] as Extract<Entry, { kind: 'text' }>).text).toBe('a1')
    expect(useChatStore.getState().hosts[HOST]?.restored).toBe(true)
    useChatStore.getState().resetTranscript(HOST)
    expect(useChatStore.getState().hosts[HOST]?.restored).toBe(false)
  })
})
