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
    onError: (message) => events.push({ type: 'turn_error', message })
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

  it('non-delta events flush pending deltas first', () => {
    const store = useChatStore.getState()
    store.applyEvent({ hostId: HOST, event: { type: 'turn_start' } })
    store.applyEvent({ hostId: HOST, event: { type: 'assistant_delta', text: 'partial' } })
    store.applyEvent({ hostId: HOST, event: { type: 'tool_start', call: { id: 'c1', name: 'bash', args: { command: 'ls' } } } })
    const list = entries()
    expect(list[0]).toMatchObject({ kind: 'text', text: 'partial', open: false })
    expect(list[1]).toMatchObject({ kind: 'tool', call: { id: 'c1' }, result: null })
  })

  it('tool update and end fill the matching block', () => {
    const store = useChatStore.getState()
    store.applyEvent({ hostId: HOST, event: { type: 'tool_start', call: { id: 'c1', name: 'bash', args: {} } } })
    store.applyEvent({ hostId: HOST, event: { type: 'tool_update', id: 'c1', text: 'line 1' } })
    expect(entries()[0]).toMatchObject({ partial: 'line 1' })
    store.applyEvent({ hostId: HOST, event: { type: 'tool_end', call: { id: 'c1', name: 'bash', args: {} }, result: { text: 'line 1\nline 2', isError: false, patch: null } } })
    expect(entries()[0]).toMatchObject({ result: { text: 'line 1\nline 2' } })
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
})
