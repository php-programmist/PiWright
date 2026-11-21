import { describe, expect, it } from 'vitest'
import { LoopController } from '../src/main/pi/loop-controller'
import type { LoopInfo, UiEvent } from '../src/shared/agent-events'
import type { PiEventMessage, ProjectEntry } from '../src/shared/ipc-contracts'
import type { PiHost } from '../src/main/pi/pi-host'
import type { SessionHost } from '../src/main/pi/session-host'

const project: ProjectEntry = { kind: 'native', dir: 'D:\\Work\\api' }

interface CreatedSession {
  id: string
  prompts: string[]
  renames: string[]
}

/** Р¤РµР№РєРѕРІС‹Р№ PiHost: create() РІС‹РґР°С‘С‚ СЃРµСЃСЃРёРё host-1, host-2вЂ¦ СЃ РЅР°СЃС‚СЂР°РёРІР°РµРјС‹РјРё РґРёР°Р»РѕРіР°РјРё. */
function fakePiHost(pendingDialogs: string[] = []): { piHost: PiHost; created: CreatedSession[] } {
  const created: CreatedSession[] = []
  let n = 0
  const piHost = {
    get: (hostId: string) =>
      hostId === 'host-1'
        ? ({
            id: hostId,
            project,
            displayTitle: 'base',
            getPendingDialogs: () => pendingDialogs.map((id) => ({ id }))
          } as unknown as SessionHost)
        : ({
            id: hostId,
            project,
            displayTitle: 'base',
            getPendingDialogs: () => []
          } as unknown as SessionHost),
    create: () => {
      n += 1
      const session: CreatedSession = { id: `host-${n + 1}`, prompts: [], renames: [] }
      created.push(session)
      return {
        id: session.id,
        project,
        displayTitle: 'base',
        getPendingDialogs: () => [],
        rename: (name: string) => {
          session.renames.push(name)
          return Promise.resolve({ ok: true, error: null })
        },
        prompt: (text: string) => {
          session.prompts.push(text)
          return Promise.resolve({ ok: true, error: null })
        }
      } as unknown as SessionHost
    }
  } as unknown as PiHost
  return { piHost, created }
}

function collector(): { events: Map<string, UiEvent[]>; emit: (hostId: string, event: UiEvent) => void } {
  const events = new Map<string, UiEvent[]>()
  return {
    events,
    emit: (hostId, event) => {
      const list = events.get(hostId) ?? []
      list.push(event)
      events.set(hostId, list)
    }
  }
}

function ev(hostId: string, event: UiEvent): PiEventMessage {
  return { hostId, event }
}

/** РЎРїР°РІРЅ Рё РїСЂРѕРјРїС‚ СѓС…РѕРґСЏС‚ С‡РµСЂРµР· РјРёРєСЂРѕС‚Р°СЃРєРё вЂ” РґР°С‘Рј С†РµРїРѕС‡РєРµ РїСЂРѕРјРёСЃРѕРІ РґРѕР№С‚Рё РґРѕ РєРѕРЅС†Р°. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function loopState(controller: LoopController, hostId: string): LoopInfo | null {
  return controller.get(hostId)
}

function turnWithTool(hostId: string): PiEventMessage[] {
  return [
    ev(hostId, { type: 'turn_start' }),
    ev(hostId, { type: 'tool_start', call: { id: 't1', name: 'read', args: {}, parentToolCallId: null } }),
    ev(hostId, { type: 'tool_end', call: { id: 't1', name: 'read', args: {}, parentToolCallId: null }, result: { text: '', isError: false, patch: null } }),
    ev(hostId, { type: 'turn_end' })
  ]
}

function turnWithoutTool(hostId: string): PiEventMessage[] {
  return [ev(hostId, { type: 'turn_start' }), ev(hostId, { type: 'turn_end' })]
}

describe('LoopController (auto-continue)', () => {
  it('turn with a tool call spawns the next iteration with the same prompt', async () => {
    const { piHost, created } = fakePiHost()
    const { emit } = collector()
    const controller = new LoopController(piHost, emit)
    expect(controller.start('host-1', 'do the task', 5, 'stop when the file has 3 lines')).toMatchObject({ active: true, remaining: 5 })
    for (const m of turnWithTool('host-1')) controller.onEvent(m)
    await flush()
    expect(created).toHaveLength(1)
    expect(created[0].prompts).toHaveLength(1)
    expect(created[0].prompts[0]).toContain('do the task')
    expect(created[0].prompts[0]).toContain('Условие выхода из петли')
    expect(created[0].renames).toEqual(['base (2)'])
    expect(loopState(controller, 'host-1')).toBeNull()
    expect(loopState(controller, 'host-2')).toMatchObject({ active: true, remaining: 4 })
  })

  it('nested tool calls (parentToolCallId) do not count as turn activity by themselves', () => {
    const { piHost, created } = fakePiHost()
    const { emit } = collector()
    const controller = new LoopController(piHost, emit)
    controller.start('host-1', 'p', 5, 'stop when the file has 3 lines')
    controller.onEvent(ev('host-1', { type: 'turn_start' }))
    controller.onEvent(ev('host-1', { type: 'tool_start', call: { id: 't1', name: 'read', args: {}, parentToolCallId: 'p1' } }))
    controller.onEvent(ev('host-1', { type: 'turn_end' }))
    expect(created).toHaveLength(0)
    expect(loopState(controller, 'host-1')).toMatchObject({ active: false, reason: 'agent' })
  })

  it('turn without tool calls stops the loop with reason agent', () => {
    const { piHost, created } = fakePiHost()
    const { emit } = collector()
    const controller = new LoopController(piHost, emit)
    controller.start('host-1', 'p', 5, 'stop when the file has 3 lines')
    for (const m of turnWithoutTool('host-1')) controller.onEvent(m)
    expect(created).toHaveLength(0)
    expect(loopState(controller, 'host-1')).toMatchObject({ active: false, reason: 'agent' })
  })

  it('loop_stop tool call stops the loop with reason exit even when the turn used tools', async () => {
    const { piHost, created } = fakePiHost()
    const { emit } = collector()
    const controller = new LoopController(piHost, emit)
    controller.start('host-1', 'p', 5, 'stop when the file has 3 lines')
    controller.onEvent(ev('host-1', { type: 'turn_start' }))
    controller.onEvent(ev('host-1', { type: 'tool_start', call: { id: 't1', name: 'read', args: {}, parentToolCallId: null } }))
    controller.onEvent(ev('host-1', { type: 'tool_start', call: { id: 't2', name: 'loop_stop', args: {}, parentToolCallId: null } }))
    controller.onEvent(ev('host-1', { type: 'turn_end' }))
    await flush()
    expect(created).toHaveLength(0)
    expect(loopState(controller, 'host-1')).toMatchObject({ active: false, reason: 'exit' })
  })

  it('nested loop_stop (parentToolCallId) does not stop the loop', () => {
    const { piHost, created } = fakePiHost()
    const { emit } = collector()
    const controller = new LoopController(piHost, emit)
    controller.start('host-1', 'p', 5, 'stop when the file has 3 lines')
    controller.onEvent(ev('host-1', { type: 'turn_start' }))
    controller.onEvent(ev('host-1', { type: 'tool_start', call: { id: 't1', name: 'loop_stop', args: {}, parentToolCallId: 'p1' } }))
    controller.onEvent(ev('host-1', { type: 'turn_end' }))
    expect(created).toHaveLength(0)
    expect(loopState(controller, 'host-1')).toMatchObject({ active: false, reason: 'agent' })
  })

  it('turn ending with a pending dialog waits instead of spawning', () => {
    const { piHost, created } = fakePiHost(['dlg-1'])
    const { emit } = collector()
    const controller = new LoopController(piHost, emit)
    controller.start('host-1', 'p', 5, 'stop when the file has 3 lines')
    for (const m of turnWithTool('host-1')) controller.onEvent(m)
    expect(created).toHaveLength(0)
    expect(loopState(controller, 'host-1')).toMatchObject({ active: true, reason: null })
  })

  it('turn ending with running subagents defers the spawn until they complete', async () => {
    const { piHost, created } = fakePiHost()
    const { emit } = collector()
    const controller = new LoopController(piHost, emit)
    controller.start('host-1', 'p', 5, 'stop when the file has 3 lines')
    controller.onEvent(ev('host-1', { type: 'turn_start' }))
    controller.onEvent(ev('host-1', { type: 'tool_start', call: { id: 't1', name: 'agent', args: {}, parentToolCallId: null } }))
    controller.onEvent(ev('host-1', { type: 'subagents_activity', kind: 'started', id: 'sa-1' }))
    controller.onEvent(ev('host-1', { type: 'turn_end' }))
    expect(created).toHaveLength(0)
    expect(loopState(controller, 'host-1')).toMatchObject({ active: true })
    controller.onEvent(ev('host-1', { type: 'subagents_activity', kind: 'completed', id: 'sa-1' }))
    await flush()
    expect(created).toHaveLength(1)
    expect(created[0].prompts[0]).toContain('p')
    expect(created[0].prompts[0]).toContain('Условие выхода из петли')
  })

  it('workflow_started/workflow_settled defer the spawn the same way', async () => {
    const { piHost, created } = fakePiHost()
    const { emit } = collector()
    const controller = new LoopController(piHost, emit)
    controller.start('host-1', 'p', 5, 'stop when the file has 3 lines')
    controller.onEvent(ev('host-1', { type: 'turn_start' }))
    controller.onEvent(ev('host-1', { type: 'tool_start', call: { id: 't1', name: 'workflow', args: {}, parentToolCallId: null } }))
    controller.onEvent(ev('host-1', { type: 'subagents_activity', kind: 'workflow_started', id: 'w1' }))
    controller.onEvent(ev('host-1', { type: 'turn_end' }))
    expect(created).toHaveLength(0)
    controller.onEvent(ev('host-1', { type: 'subagents_activity', kind: 'workflow_settled', id: 'w1' }))
    await flush()
    expect(created).toHaveLength(1)
  })

  it('subagents:disposed clears the wait', async () => {
    const { piHost, created } = fakePiHost()
    const { emit } = collector()
    const controller = new LoopController(piHost, emit)
    controller.start('host-1', 'p', 5, 'stop when the file has 3 lines')
    controller.onEvent(ev('host-1', { type: 'turn_start' }))
    controller.onEvent(ev('host-1', { type: 'tool_start', call: { id: 't1', name: 'agent', args: {}, parentToolCallId: null } }))
    controller.onEvent(ev('host-1', { type: 'subagents_activity', kind: 'started', id: 'sa-1' }))
    controller.onEvent(ev('host-1', { type: 'turn_end' }))
    expect(created).toHaveLength(0)
    controller.onEvent(ev('host-1', { type: 'subagents_activity', kind: 'disposed', id: null }))
    await flush()
    expect(created).toHaveLength(1)
  })

  it('remaining 0 stops the loop with reason max', async () => {
    const { piHost, created } = fakePiHost()
    const { emit } = collector()
    const controller = new LoopController(piHost, emit)
    controller.start('host-1', 'p', 1, 'stop when the file has 3 lines')
    for (const m of turnWithTool('host-1')) controller.onEvent(m)
    await flush()
    expect(created).toHaveLength(1)
    expect(loopState(controller, 'host-2')).toMatchObject({ active: true, remaining: 0 })
    for (const m of turnWithTool('host-2')) controller.onEvent(m)
    expect(created).toHaveLength(1)
    expect(loopState(controller, 'host-2')).toMatchObject({ active: false, reason: 'max' })
  })

  it('stop() marks the loop stopped by user', () => {
    const { piHost, created } = fakePiHost()
    const { emit } = collector()
    const controller = new LoopController(piHost, emit)
    controller.start('host-1', 'p', 5, 'stop when the file has 3 lines')
    controller.stop('host-1')
    for (const m of turnWithTool('host-1')) controller.onEvent(m)
    expect(created).toHaveLength(0)
    expect(loopState(controller, 'host-1')).toMatchObject({ active: false, reason: 'user' })
  })

  it('three iterations faster than 10s each trip the short-circuit guard', () => {
    const { piHost, created } = fakePiHost()
    const { emit } = collector()
    const controller = new LoopController(piHost, emit)
    controller.start('host-1', 'p', 20, 'stop when the file has 3 lines')
    for (let i = 0; i < 2; i++) {
      const hostId = i === 0 ? 'host-1' : created[created.length - 1].id
      for (const m of turnWithTool(hostId)) controller.onEvent(m)
    }
    expect(created).toHaveLength(2)
    const lastId = created[created.length - 1].id
    for (const m of turnWithTool(lastId)) controller.onEvent(m)
    expect(created).toHaveLength(2)
    const finalHostId = created[created.length - 1].id
    expect(loopState(controller, finalHostId)).toMatchObject({ active: false, reason: 'short-circuit' })
  })
})
