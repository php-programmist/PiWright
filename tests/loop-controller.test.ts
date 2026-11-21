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

/** Фейковый PiHost: create() выдаёт сессии host-2, host-3…; host-1 умеет принимать check-промпты. */
function fakePiHost(pendingDialogs: string[] = []): { piHost: PiHost; created: CreatedSession[]; checks: string[] } {
  const created: CreatedSession[] = []
  const checks: string[] = []
  let n = 0
  const piHost = {
    get: (hostId: string) => {
      if (hostId === 'host-1') {
        return {
          id: hostId,
          project,
          displayTitle: 'base',
          getPendingDialogs: () => pendingDialogs.map((id) => ({ id })),
          prompt: (text: string) => {
            checks.push(text)
            return Promise.resolve({ ok: true, error: null })
          }
        }
      }
      const made = created.find((c) => c.id === hostId)
      if (made !== undefined) {
        return {
          id: hostId,
          project,
          displayTitle: 'base',
          getPendingDialogs: () => [],
          prompt: (text: string) => {
            made.prompts.push(text)
            return Promise.resolve({ ok: true, error: null })
          }
        }
      }
      return { id: hostId, project, displayTitle: 'base', getPendingDialogs: () => [] }
    },
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
  return { piHost, created, checks }
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

function loopState(controller: LoopController, hostId: string): LoopInfo | null {
  return controller.get(hostId)
}

const EXIT = 'stop when the file has 3 lines'

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

/** Спавн и промпт уходят через микротаски — даём цепочке промисов дойти до конца. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('LoopController (auto-continue with check turn)', () => {
  it('work turn with tools sends a check prompt into the same session', async () => {
    const { piHost, created, checks } = fakePiHost()
    const { emit } = collector()
    const controller = new LoopController(piHost, emit)
    expect(controller.start('host-1', 'do the task', 5, EXIT)).toMatchObject({ active: true, remaining: 5 })
    for (const m of turnWithTool('host-1')) controller.onEvent(m)
    await flush()
    expect(created).toHaveLength(0)
    expect(checks).toHaveLength(1)
    expect(checks[0]).toContain(EXIT)
    expect(loopState(controller, 'host-1')).toMatchObject({ active: true })
  })

  it('duplicate turn_end (agent_end + agent_settled) is processed once', async () => {
    const { piHost, created, checks } = fakePiHost()
    const { emit } = collector()
    const controller = new LoopController(piHost, emit)
    controller.start('host-1', 'p', 5, EXIT)
    controller.onEvent(ev('host-1', { type: 'turn_start' }))
    controller.onEvent(ev('host-1', { type: 'tool_start', call: { id: 't1', name: 'read', args: {}, parentToolCallId: null } }))
    controller.onEvent(ev('host-1', { type: 'turn_end' }))
    controller.onEvent(ev('host-1', { type: 'turn_end' }))
    await flush()
    expect(checks).toHaveLength(1)
    expect(created).toHaveLength(0)
    for (const m of turnWithoutTool('host-1')) controller.onEvent(m)
    controller.onEvent(ev('host-1', { type: 'turn_end' }))
    await flush()
    expect(created).toHaveLength(1)
  })

  it('check turn without loop_stop spawns the next iteration with the plain prompt', async () => {
    const { piHost, created, checks } = fakePiHost()
    const { emit } = collector()
    const controller = new LoopController(piHost, emit)
    controller.start('host-1', 'do the task', 5, EXIT)
    for (const m of turnWithTool('host-1')) controller.onEvent(m)
    await flush()
    expect(checks).toHaveLength(1)
    for (const m of turnWithoutTool('host-1')) controller.onEvent(m)
    await flush()
    expect(created).toHaveLength(1)
    expect(created[0].prompts).toEqual(['do the task'])
    expect(created[0].renames).toEqual(['base (2)'])
    expect(loopState(controller, 'host-1')).toBeNull()
    expect(loopState(controller, 'host-2')).toMatchObject({ active: true, remaining: 4 })
  })

  it('check turn with loop_stop stops the loop with reason exit', async () => {
    const { piHost, created, checks } = fakePiHost()
    const { emit } = collector()
    const controller = new LoopController(piHost, emit)
    controller.start('host-1', 'p', 5, EXIT)
    for (const m of turnWithTool('host-1')) controller.onEvent(m)
    await flush()
    expect(checks).toHaveLength(1)
    controller.onEvent(ev('host-1', { type: 'turn_start' }))
    controller.onEvent(ev('host-1', { type: 'tool_start', call: { id: 't2', name: 'loop_stop', args: {}, parentToolCallId: null } }))
    controller.onEvent(ev('host-1', { type: 'turn_end' }))
    await flush()
    expect(created).toHaveLength(0)
    expect(loopState(controller, 'host-1')).toMatchObject({ active: false, reason: 'exit' })
  })

  it('loop_stop in a work turn stops the loop without a check prompt', async () => {
    const { piHost, created, checks } = fakePiHost()
    const { emit } = collector()
    const controller = new LoopController(piHost, emit)
    controller.start('host-1', 'p', 5, EXIT)
    controller.onEvent(ev('host-1', { type: 'turn_start' }))
    controller.onEvent(ev('host-1', { type: 'tool_start', call: { id: 't1', name: 'read', args: {}, parentToolCallId: null } }))
    controller.onEvent(ev('host-1', { type: 'tool_start', call: { id: 't2', name: 'loop_stop', args: {}, parentToolCallId: null } }))
    controller.onEvent(ev('host-1', { type: 'turn_end' }))
    await flush()
    expect(checks).toHaveLength(0)
    expect(created).toHaveLength(0)
    expect(loopState(controller, 'host-1')).toMatchObject({ active: false, reason: 'exit' })
  })

  it('nested loop_stop (parentToolCallId) does not stop the loop', async () => {
    const { piHost, created } = fakePiHost()
    const { emit } = collector()
    const controller = new LoopController(piHost, emit)
    controller.start('host-1', 'p', 5, EXIT)
    controller.onEvent(ev('host-1', { type: 'turn_start' }))
    controller.onEvent(ev('host-1', { type: 'tool_start', call: { id: 't1', name: 'loop_stop', args: {}, parentToolCallId: 'p1' } }))
    controller.onEvent(ev('host-1', { type: 'turn_end' }))
    expect(created).toHaveLength(0)
    expect(loopState(controller, 'host-1')).toMatchObject({ active: false, reason: 'agent' })
  })

  it('work turn without tool calls stops the loop with reason agent', async () => {
    const { piHost, created, checks } = fakePiHost()
    const { emit } = collector()
    const controller = new LoopController(piHost, emit)
    controller.start('host-1', 'p', 5, EXIT)
    for (const m of turnWithoutTool('host-1')) controller.onEvent(m)
    await flush()
    expect(checks).toHaveLength(0)
    expect(created).toHaveLength(0)
    expect(loopState(controller, 'host-1')).toMatchObject({ active: false, reason: 'agent' })
  })

  it('work turn ending with a pending dialog waits instead of checking', async () => {
    const { piHost, checks } = fakePiHost(['dlg-1'])
    const { emit } = collector()
    const controller = new LoopController(piHost, emit)
    controller.start('host-1', 'p', 5, EXIT)
    for (const m of turnWithTool('host-1')) controller.onEvent(m)
    await flush()
    expect(checks).toHaveLength(0)
    expect(loopState(controller, 'host-1')).toMatchObject({ active: true, reason: null })
  })

  it('work turn ending with running subagents defers the check until they complete', async () => {
    const { piHost, created, checks } = fakePiHost()
    const { emit } = collector()
    const controller = new LoopController(piHost, emit)
    controller.start('host-1', 'p', 5, EXIT)
    controller.onEvent(ev('host-1', { type: 'turn_start' }))
    controller.onEvent(ev('host-1', { type: 'tool_start', call: { id: 't1', name: 'agent', args: {}, parentToolCallId: null } }))
    controller.onEvent(ev('host-1', { type: 'subagents_activity', kind: 'started', id: 'sa-1' }))
    controller.onEvent(ev('host-1', { type: 'turn_end' }))
    await flush()
    expect(checks).toHaveLength(0)
    expect(loopState(controller, 'host-1')).toMatchObject({ active: true })
    controller.onEvent(ev('host-1', { type: 'subagents_activity', kind: 'completed', id: 'sa-1' }))
    await flush()
    expect(checks).toHaveLength(1)
    for (const m of turnWithoutTool('host-1')) controller.onEvent(m)
    await flush()
    expect(created).toHaveLength(1)
    expect(created[0].prompts[0]).toBe('p')
  })

  it('workflow_started/workflow_settled defer the check the same way', async () => {
    const { piHost, checks } = fakePiHost()
    const { emit } = collector()
    const controller = new LoopController(piHost, emit)
    controller.start('host-1', 'p', 5, EXIT)
    controller.onEvent(ev('host-1', { type: 'turn_start' }))
    controller.onEvent(ev('host-1', { type: 'tool_start', call: { id: 't1', name: 'workflow', args: {}, parentToolCallId: null } }))
    controller.onEvent(ev('host-1', { type: 'subagents_activity', kind: 'workflow_started', id: 'w1' }))
    controller.onEvent(ev('host-1', { type: 'turn_end' }))
    expect(checks).toHaveLength(0)
    controller.onEvent(ev('host-1', { type: 'subagents_activity', kind: 'workflow_settled', id: 'w1' }))
    await flush()
    expect(checks).toHaveLength(1)
  })

  it('subagents:disposed clears the wait', async () => {
    const { piHost, checks } = fakePiHost()
    const { emit } = collector()
    const controller = new LoopController(piHost, emit)
    controller.start('host-1', 'p', 5, EXIT)
    controller.onEvent(ev('host-1', { type: 'turn_start' }))
    controller.onEvent(ev('host-1', { type: 'tool_start', call: { id: 't1', name: 'agent', args: {}, parentToolCallId: null } }))
    controller.onEvent(ev('host-1', { type: 'subagents_activity', kind: 'started', id: 'sa-1' }))
    controller.onEvent(ev('host-1', { type: 'turn_end' }))
    expect(checks).toHaveLength(0)
    controller.onEvent(ev('host-1', { type: 'subagents_activity', kind: 'disposed', id: null }))
    await flush()
    expect(checks).toHaveLength(1)
  })

  it('remaining 0 stops the loop with reason max', async () => {
    const { piHost, created } = fakePiHost()
    const { emit } = collector()
    const controller = new LoopController(piHost, emit)
    controller.start('host-1', 'p', 1, EXIT)
    for (const m of turnWithTool('host-1')) controller.onEvent(m)
    await flush()
    for (const m of turnWithoutTool('host-1')) controller.onEvent(m)
    await flush()
    expect(created).toHaveLength(1)
    expect(loopState(controller, 'host-2')).toMatchObject({ active: true, remaining: 0 })
    for (const m of turnWithTool('host-2')) controller.onEvent(m)
    await flush()
    for (const m of turnWithoutTool('host-2')) controller.onEvent(m)
    expect(created).toHaveLength(1)
    expect(loopState(controller, 'host-2')).toMatchObject({ active: false, reason: 'max' })
  })

  it('stop() marks the loop stopped by user', async () => {
    const { piHost, created } = fakePiHost()
    const { emit } = collector()
    const controller = new LoopController(piHost, emit)
    controller.start('host-1', 'p', 5, EXIT)
    controller.stop('host-1')
    for (const m of turnWithTool('host-1')) controller.onEvent(m)
    await flush()
    for (const m of turnWithoutTool('host-1')) controller.onEvent(m)
    expect(created).toHaveLength(0)
    expect(loopState(controller, 'host-1')).toMatchObject({ active: false, reason: 'user' })
  })

  it('three iterations faster than 10s each trip the short-circuit guard', async () => {
    const { piHost, created } = fakePiHost()
    const { emit } = collector()
    const controller = new LoopController(piHost, emit)
    controller.start('host-1', 'p', 20, EXIT)
    for (let i = 0; i < 2; i++) {
      const hostId = i === 0 ? 'host-1' : created[created.length - 1].id
      for (const m of turnWithTool(hostId)) controller.onEvent(m)
      await flush()
      for (const m of turnWithoutTool(hostId)) controller.onEvent(m)
      await flush()
    }
    expect(created).toHaveLength(2)
    const lastId = created[created.length - 1].id
    for (const m of turnWithTool(lastId)) controller.onEvent(m)
    await flush()
    for (const m of turnWithoutTool(lastId)) controller.onEvent(m)
    expect(created).toHaveLength(2)
    const finalHostId = created[created.length - 1].id
    expect(loopState(controller, finalHostId)).toMatchObject({ active: false, reason: 'short-circuit' })
  })

  it('stopAll stops every active loop (setting turned off)', async () => {
    const { piHost } = fakePiHost()
    const { emit, events } = collector()
    const controller = new LoopController(piHost, emit)
    controller.start('host-1', 'p', 5, EXIT)
    controller.start('host-9', 'p', 5, EXIT)
    controller.stop('host-9')
    controller.stopAll()
    expect(loopState(controller, 'host-1')).toMatchObject({ active: false, reason: 'user' })
    expect(loopState(controller, 'host-9')).toMatchObject({ active: false, reason: 'user' })
    const host1States = events.get('host-1')?.filter((e) => e.type === 'loop_state') ?? []
    expect(host1States.at(-1)).toMatchObject({ info: { active: false, reason: 'user' } })
  })
})
