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

/** Р¤РµР№РєРѕРІС‹Р№ PiHost: create() РІС‹РґР°С‘С‚ СЃРµСЃСЃРёРё host-2, host-3вЂ¦; host-1 СѓРјРµРµС‚ РїСЂРёРЅРёРјР°С‚СЊ check-РїСЂРѕРјРїС‚С‹. */
function fakePiHost(pendingDialogs: string[] = [], statusState = 'idle', projectOverride?: ProjectEntry): {
  piHost: PiHost
  created: CreatedSession[]
  checks: string[]
  setStatus: (state: string) => void
  spawnOverrides: ({ model: string | null; thinkingLevel: string | null } | undefined)[]
  createProjects: unknown[]
} {
  let status = statusState
  const created: CreatedSession[] = []
  const checks: string[] = []
  const spawnOverrides: ({ model: string | null; thinkingLevel: string | null } | undefined)[] = []
  const createProjects: unknown[] = []
  const proj = projectOverride ?? project
  let n = 0
  const piHost = {
    get: (hostId: string) => {
      if (hostId === 'host-1') {
        return {
          id: hostId,
          project: proj,
          displayTitle: 'base',
          getPendingDialogs: () => pendingDialogs.map((id) => ({ id })),
          lastStatus: () => ({ state: status, model: 'anthropic/claude-opus-4', thinkingLevel: 'high' }),
          markCheckTurn: () => {},
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
          project: proj,
          displayTitle: 'base',
          getPendingDialogs: () => [],
          lastStatus: () => null,
          markCheckTurn: () => {},
          prompt: (text: string) => {
            made.prompts.push(text)
            return Promise.resolve({ ok: true, error: null })
          }
        }
      }
      return { id: hostId, project: proj, displayTitle: 'base', getPendingDialogs: () => [], lastStatus: () => null }
    },
    create: (_project: unknown, _sessionFile: unknown, overrides?: { model: string | null; thinkingLevel: string | null }) => {
      createProjects.push(_project)
      spawnOverrides.push(overrides)
      n += 1
      const session: CreatedSession = { id: `host-${n + 1}`, prompts: [], renames: [] }
      created.push(session)
      return {
        id: session.id,
        project: proj,
        displayTitle: 'base',
        getPendingDialogs: () => [],
        markCheckTurn: () => {},
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
  return { piHost, created, checks, setStatus: (next) => { status = next }, spawnOverrides, createProjects }
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

/** РЎРїР°РІРЅ Рё РїСЂРѕРјРїС‚ СѓС…РѕРґСЏС‚ С‡РµСЂРµР· РјРёРєСЂРѕС‚Р°СЃРєРё вЂ” РґР°С‘Рј С†РµРїРѕС‡РєРµ РїСЂРѕРјРёСЃРѕРІ РґРѕР№С‚Рё РґРѕ РєРѕРЅС†Р°. */
const GRACE_MS = 10
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, GRACE_MS * 3))

describe('LoopController (auto-continue with check turn)', () => {
  it('work turn with tools sends a check prompt into the same session', async () => {
    const { piHost, created, checks } = fakePiHost()
    const { emit } = collector()
    const controller = new LoopController(piHost, emit, undefined, GRACE_MS)
    expect(controller.start('host-1', 'do the task', 5, EXIT)).toMatchObject({ active: true, remaining: 5 })
    for (const m of turnWithTool('host-1')) controller.onEvent(m)
    await flush()
    expect(created).toHaveLength(0)
    expect(checks).toHaveLength(1)
    expect(checks[0]).toContain(EXIT)
    expect(loopState(controller, 'host-1')).toMatchObject({ active: true })
  })

  it('empty exit condition skips the check and spawns the next iteration right away', async () => {
    const { piHost, created, checks } = fakePiHost()
    const { emit } = collector()
    const controller = new LoopController(piHost, emit, undefined, GRACE_MS)
    controller.start('host-1', 'do the task', 5, '')
    for (const m of turnWithTool('host-1')) controller.onEvent(m)
    await flush()
    expect(checks).toHaveLength(0)
    expect(created).toHaveLength(1)
    expect(created[0].prompts).toEqual(['do the task'])
    expect(loopState(controller, 'host-2')).toMatchObject({ active: true, remaining: 4 })
  })

  it('spawn copies the parent session model and thinking level', async () => {
    const { piHost, spawnOverrides } = fakePiHost()
    const { emit } = collector()
    const controller = new LoopController(piHost, emit, undefined, GRACE_MS)
    controller.start('host-1', 'do the task', 5, '')
    for (const m of turnWithTool('host-1')) controller.onEvent(m)
    await flush()
    expect(spawnOverrides[0]).toEqual({ model: 'anthropic/claude-opus-4', thinkingLevel: 'high' })
  })

  it('empty exit condition still honors loop_stop in a work turn', async () => {
    const { piHost, created, checks } = fakePiHost()
    const { emit } = collector()
    const controller = new LoopController(piHost, emit, undefined, GRACE_MS)
    controller.start('host-1', 'p', 5, '')
    controller.onEvent(ev('host-1', { type: 'turn_start' }))
    controller.onEvent(ev('host-1', { type: 'tool_start', call: { id: 't1', name: 'read', args: {}, parentToolCallId: null } }))
    controller.onEvent(ev('host-1', { type: 'tool_start', call: { id: 't2', name: 'loop_stop', args: {}, parentToolCallId: null } }))
    controller.onEvent(ev('host-1', { type: 'turn_end' }))
    await flush()
    expect(checks).toHaveLength(0)
    expect(created).toHaveLength(0)
    expect(loopState(controller, 'host-1')).toMatchObject({ active: false, reason: 'exit' })
  })

  it('duplicate turn_end (agent_end + agent_settled) is processed once', async () => {
    const { piHost, created, checks } = fakePiHost()
    const { emit } = collector()
    const controller = new LoopController(piHost, emit, undefined, GRACE_MS)
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
    const controller = new LoopController(piHost, emit, undefined, GRACE_MS)
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
    const controller = new LoopController(piHost, emit, undefined, GRACE_MS)
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
    const controller = new LoopController(piHost, emit, undefined, GRACE_MS)
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
    const controller = new LoopController(piHost, emit, undefined, GRACE_MS)
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
    const controller = new LoopController(piHost, emit, undefined, GRACE_MS)
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
    const controller = new LoopController(piHost, emit, undefined, GRACE_MS)
    controller.start('host-1', 'p', 5, EXIT)
    for (const m of turnWithTool('host-1')) controller.onEvent(m)
    await flush()
    expect(checks).toHaveLength(0)
    expect(loopState(controller, 'host-1')).toMatchObject({ active: true, reason: null })
  })

  it('work turn ending with running subagents defers the check until they complete', async () => {
    const { piHost, created, checks } = fakePiHost()
    const { emit } = collector()
    const controller = new LoopController(piHost, emit, undefined, GRACE_MS)
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
    const controller = new LoopController(piHost, emit, undefined, GRACE_MS)
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

  it('subagents:started arriving after turn_end (grace window) defers the check', async () => {
    const { piHost, created, checks } = fakePiHost()
    const { emit } = collector()
    const controller = new LoopController(piHost, emit, undefined, GRACE_MS)
    controller.start('host-1', 'p', 5, EXIT)
    controller.onEvent(ev('host-1', { type: 'turn_start' }))
    controller.onEvent(ev('host-1', { type: 'tool_start', call: { id: 't1', name: 'agent', args: {}, parentToolCallId: null } }))
    controller.onEvent(ev('host-1', { type: 'turn_end' }))
    // Спавн ушел асинхронно: started приходит уже после turn_end, но в пределах грейс-паузы
    controller.onEvent(ev('host-1', { type: 'subagents_activity', kind: 'started', id: 'sa-1' }))
    await flush()
    expect(checks).toHaveLength(0)
    expect(loopState(controller, 'host-1')).toMatchObject({ active: true })
    controller.onEvent(ev('host-1', { type: 'subagents_activity', kind: 'completed', id: 'sa-1' }))
    await flush()
    expect(checks).toHaveLength(1)
    for (const m of turnWithoutTool('host-1')) controller.onEvent(m)
    await flush()
    expect(created).toHaveLength(1)
  })

  it('grace window expires with no subagents — check is sent as before', async () => {
    const { piHost, checks } = fakePiHost()
    const { emit } = collector()
    const controller = new LoopController(piHost, emit, undefined, GRACE_MS)
    controller.start('host-1', 'p', 5, EXIT)
    for (const m of turnWithTool('host-1')) controller.onEvent(m)
    expect(checks).toHaveLength(0)
    await flush()
    expect(checks).toHaveLength(1)
  })

  it('external nudge turn between work turn and check does not kill the loop', async () => {
    const { piHost, created, checks } = fakePiHost()
    const { emit } = collector()
    const controller = new LoopController(piHost, emit, undefined, GRACE_MS)
    controller.start('host-1', 'p', 5, EXIT)
    for (const m of turnWithTool('host-1')) controller.onEvent(m)
    await flush()
    expect(checks).toHaveLength(1)
    // Check-ход завершился без loop_stop — должен спавниться, но перед этим пришёл
    // внешний nudge-ход субагента (без инструментов) — он петлю не останавливает.
    controller.onEvent(ev('host-1', { type: 'turn_start', external: true }))
    controller.onEvent(ev('host-1', { type: 'turn_end' }))
    controller.onEvent(ev('host-1', { type: 'turn_end' }))
    await flush()
    expect(loopState(controller, 'host-1')).toMatchObject({ active: true, reason: null })
    for (const m of turnWithoutTool('host-1')) controller.onEvent(m)
    await flush()
    expect(created).toHaveLength(1)
    expect(created[0].prompts[0]).toBe('p')
  })

  it('work turn deferred by SessionHost is resolved by the subagent nudge turn', async () => {
    const { piHost, checks } = fakePiHost()
    const { emit } = collector()
    const controller = new LoopController(piHost, emit, undefined, GRACE_MS)
    controller.start('host-1', 'p', 5, EXIT)
    // SessionHost при живом субагенте turn_end рабочего хода не присылает вовсе.
    controller.onEvent(ev('host-1', { type: 'turn_start' }))
    controller.onEvent(ev('host-1', { type: 'tool_start', call: { id: 't1', name: 'agent', args: {}, parentToolCallId: null } }))
    controller.onEvent(ev('host-1', { type: 'subagents_activity', kind: 'started', id: 'sa-1' }))
    controller.onEvent(ev('host-1', { type: 'subagents_activity', kind: 'completed', id: 'sa-1' }))
    // Единственный turn_end на всю цепочку приносит ход-нудж субагента.
    controller.onEvent(ev('host-1', { type: 'turn_start', external: true }))
    controller.onEvent(ev('host-1', { type: 'turn_end' }))
    await flush()
    expect(checks).toHaveLength(1)
    expect(loopState(controller, 'host-1')).toMatchObject({ active: true, reason: null })
  })

  it('nudge turn with no unresolved work turn leaves the loop alone', async () => {
    const { piHost, created, checks } = fakePiHost()
    const { emit } = collector()
    const controller = new LoopController(piHost, emit, undefined, GRACE_MS)
    controller.start('host-1', 'p', 5, EXIT)
    for (const m of turnWithTool('host-1')) controller.onEvent(m)
    await flush()
    expect(checks).toHaveLength(1)
    // Check-ход уже отправлен, рабочий ход разрешён — опоздавший нудж не должен ни
    // останавливать петлю (reason 'agent'), ни отправлять второй check.
    controller.onEvent(ev('host-1', { type: 'turn_start', external: true }))
    controller.onEvent(ev('host-1', { type: 'turn_end' }))
    await flush()
    expect(checks).toHaveLength(1)
    expect(created).toHaveLength(0)
    expect(loopState(controller, 'host-1')).toMatchObject({ active: true, reason: null })
  })

  it('watchdog force-resolves a work turn whose completion events were lost', async () => {
    const { piHost, checks, setStatus } = fakePiHost([], 'streaming')
    const { events, emit } = collector()
    const controller = new LoopController(piHost, emit, undefined, GRACE_MS, 5)
    controller.start('host-1', 'p', 5, EXIT)
    controller.onEvent(ev('host-1', { type: 'turn_start' }))
    controller.onEvent(ev('host-1', { type: 'tool_start', call: { id: 't1', name: 'agent', args: {}, parentToolCallId: null } }))
    controller.onEvent(ev('host-1', { type: 'subagents_activity', kind: 'started', id: 'sa-1' }))
    // Ход ещё стримится — watchdog только перевзводит таймер, петлю трогать нечего.
    await flush()
    expect(checks).toHaveLength(0)
    // Субагент умер без completed-события, SessionHost перевёл сессию в ready — событий больше нет.
    setStatus('ready')
    await flush()
    expect(checks).toHaveLength(1)
    expect((events.get('host-1') ?? []).filter((e) => e.type === 'notify')).toHaveLength(1)
    expect(loopState(controller, 'host-1')).toMatchObject({ active: true, reason: null })
  })

  it('external turn during grace window defers the check until it ends', async () => {
    const { piHost, checks } = fakePiHost()
    const { emit } = collector()
    const controller = new LoopController(piHost, emit, undefined, GRACE_MS)
    controller.start('host-1', 'p', 5, EXIT)
    for (const m of turnWithTool('host-1')) controller.onEvent(m)
    // Внешний ход начался в пределах грейс-паузы — check переносится до его конца.
    controller.onEvent(ev('host-1', { type: 'turn_start', external: true }))
    await flush()
    expect(checks).toHaveLength(0)
    controller.onEvent(ev('host-1', { type: 'turn_end' }))
    await flush()
    expect(checks).toHaveLength(1)
    expect(loopState(controller, 'host-1')).toMatchObject({ active: true })
  })

  it('subagents:disposed clears the wait', async () => {
    const { piHost, checks } = fakePiHost()
    const { emit } = collector()
    const controller = new LoopController(piHost, emit, undefined, GRACE_MS)
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
    const controller = new LoopController(piHost, emit, undefined, GRACE_MS)
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
    const controller = new LoopController(piHost, emit, undefined, GRACE_MS)
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
    const controller = new LoopController(piHost, emit, undefined, GRACE_MS)
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
    const controller = new LoopController(piHost, emit, undefined, GRACE_MS)
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

describe('LoopController worktree sessions (branch sync + prompt notice)', () => {
  const wtProject: ProjectEntry = { kind: 'native', dir: 'D:\\Work\\api\\.pi\\worktrees\\glm' }

  it('spawn in a worktree session syncs the branch and prefixes the prompt with the worktree notice', async () => {
    const { piHost, created, createProjects } = fakePiHost([], 'idle', wtProject)
    const syncs: unknown[] = []
    const { emit } = collector()
    const controller = new LoopController(piHost, emit, undefined, GRACE_MS, undefined, async (p) => {
      syncs.push(p)
      return { ok: true, error: null }
    })
    controller.start('host-1', 'do the task', 5, '')
    for (const m of turnWithTool('host-1')) controller.onEvent(m)
    await flush()
    expect(syncs).toEqual([wtProject])
    expect(createProjects).toEqual([wtProject])
    expect(created).toHaveLength(1)
    const prompt = created[0].prompts[0]
    expect(prompt).toContain('worktree «glm»')
    expect(prompt).toContain('worktree-glm')
    expect(prompt.endsWith('do the task')).toBe(true)
    expect(prompt.indexOf('worktree')).toBeLessThan(prompt.indexOf('do the task'))
  })

  it('non-worktree session spawns without sync and without the notice', async () => {
    const { piHost, created } = fakePiHost()
    let syncCalls = 0
    const { emit } = collector()
    const controller = new LoopController(piHost, emit, undefined, GRACE_MS, undefined, async () => {
      syncCalls += 1
      return { ok: true, error: null }
    })
    controller.start('host-1', 'do the task', 5, '')
    for (const m of turnWithTool('host-1')) controller.onEvent(m)
    await flush()
    expect(syncCalls).toBe(0)
    expect(created).toHaveLength(1)
    expect(created[0].prompts).toEqual(['do the task'])
  })

  it('failed sync still spawns the iteration and emits a notify event', async () => {
    const { piHost, created } = fakePiHost([], 'idle', wtProject)
    const { events, emit } = collector()
    const controller = new LoopController(piHost, emit, undefined, GRACE_MS, undefined, async () => ({
      ok: false,
      error: 'conflict'
    }))
    controller.start('host-1', 'do the task', 5, '')
    for (const m of turnWithTool('host-1')) controller.onEvent(m)
    await flush()
    expect(created).toHaveLength(1)
    expect(created[0].prompts[0].endsWith('do the task')).toBe(true)
    const notifies = (events.get('host-2') ?? []).filter((e) => e.type === 'notify')
    expect(notifies).toHaveLength(1)
    expect((notifies[0] as { message: string }).message).toContain('sync failed')
    expect(loopState(controller, 'host-2')).toMatchObject({ active: true })
  })

  it('stop during the sync cancels the spawn', async () => {
    const { piHost, created } = fakePiHost([], 'idle', wtProject)
    const { emit } = collector()
    const holder: { release: (() => void) | null } = { release: null }
    const controller = new LoopController(piHost, emit, undefined, GRACE_MS, undefined, () => {
      return new Promise((resolve) => {
        holder.release = () => resolve({ ok: true, error: null })
      })
    })
    controller.start('host-1', 'p', 5, '')
    for (const m of turnWithTool('host-1')) controller.onEvent(m)
    await flush()
    expect(created).toHaveLength(0)
    controller.stop('host-1')
    holder.release?.()
    await flush()
    expect(created).toHaveLength(0)
    expect(loopState(controller, 'host-1')).toMatchObject({ active: false, reason: 'user' })
  })
})
