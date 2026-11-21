/** Контроллер петли PiWright: агент сам решает продолжать (инструмент `loop_next`),
 *  каждая итерация — новая сессия того же проекта с тем же промптом. Страховки: счётчик
 *  итераций (проверяется при сигнале агента), «короткое замыкание» (3 вызова подряд
 *  с интервалом < 10 с), снятый чекбокс / закрытие сессии. */
import type { LoopInfo, LoopStopReason, UiEvent } from '../../shared/agent-events'
import type { PiEventMessage, ProjectEntry } from '../../shared/ipc-contracts'
import type { PiHost } from './pi-host'
import { LOOP_TOOL_NAME } from './loop-extension'

const SHORT_CIRCUIT_CALLS = 3
const SHORT_CIRCUIT_GAP_MS = 10_000
const MIN_ITERATIONS = 1
const MAX_ITERATIONS = 999

interface LoopState {
  prompt: string
  remaining: number
  active: boolean
  reason: LoopStopReason | null
  project: ProjectEntry
  callTimes: number[]
  toolSeenThisTurn: boolean
  /** Номер текущей итерации (стартовая сессия = 1); растёт с каждым спавном. */
  iteration: number
  /** Имя стартовой сессии без индекса — база для имён «имя (2)», «имя (3)»… */
  baseName: string
}

export class LoopController {
  private readonly states = new Map<string, LoopState>()

  constructor(
    private readonly piHost: PiHost,
    private readonly emit: (hostId: string, event: UiEvent) => void,
    /** Мост для копирования флагов прошлой сессии (Remote, Telegram) в новую. */
    private readonly onSpawned?: (previousHostId: string, createdHostId: string) => void
  ) {}

  start(hostId: string, prompt: string, maxIterations: number): LoopInfo | null {
    const host = this.piHost.get(hostId)
    if (host === null) return null
    const state: LoopState = {
      prompt,
      remaining: clampIterations(maxIterations),
      active: true,
      reason: null,
      project: host.project,
      callTimes: [],
      toolSeenThisTurn: false,
      iteration: 1,
      baseName: cleanLoopTitle(host.displayTitle)
    }
    this.states.set(hostId, state)
    this.emitState(hostId, state, null)
    return this.info(state)
  }

  stop(hostId: string): LoopInfo | null {
    const state = this.states.get(hostId)
    if (state === undefined) return null
    state.active = false
    state.reason = 'user'
    this.emitState(hostId, state, null)
    return this.info(state)
  }

  setRemaining(hostId: string, remaining: number): LoopInfo | null {
    const state = this.states.get(hostId)
    if (state === undefined) return null
    state.remaining = clampIterations(remaining)
    this.emitState(hostId, state, null)
    return this.info(state)
  }

  get(hostId: string): LoopInfo | null {
    const state = this.states.get(hostId)
    return state === undefined ? null : this.info(state)
  }

  forget(hostId: string): void {
    this.states.delete(hostId)
  }

  onEvent(message: PiEventMessage): void {
    const state = this.states.get(message.hostId)
    if (state === undefined) return
    const event = message.event
    if (event.type === 'tool_start' && event.call.name === LOOP_TOOL_NAME && event.call.parentToolCallId === null) {
      state.toolSeenThisTurn = true
      const now = Date.now()
      state.callTimes.push(now)
      if (state.callTimes.length > SHORT_CIRCUIT_CALLS) state.callTimes.shift()
      if (state.callTimes.length === SHORT_CIRCUIT_CALLS) {
        const [a, b, c] = state.callTimes
        if (b - a < SHORT_CIRCUIT_GAP_MS && c - b < SHORT_CIRCUIT_GAP_MS) {
          state.active = false
          state.reason = 'short-circuit'
          this.emitState(message.hostId, state, null)
        }
      }
      return
    }
    if (event.type === 'turn_end') {
      // turn_end приходит и на agent_end, и на agent_settled — флаг гасит двойной спавн.
      if (!state.toolSeenThisTurn) {
        // Агент закончил ход без loop_next — он решил, что петля завершена.
        if (state.active) {
          state.active = false
          state.reason = 'agent'
          this.emitState(message.hostId, state, null)
        }
        return
      }
      state.toolSeenThisTurn = false
      if (!state.active) return
      if (state.remaining <= 0) {
        state.active = false
        state.reason = 'max'
        this.emitState(message.hostId, state, null)
        return
      }
      this.spawnNext(message.hostId, state)
    }
  }

  private spawnNext(previousHostId: string, state: LoopState): void {
    state.remaining -= 1
    state.iteration += 1
    const created = this.piHost.create(state.project)
    this.states.delete(previousHostId)
    this.states.set(created.id, state)
    this.onSpawned?.(previousHostId, created.id)
    this.emit(previousHostId, {
      type: 'loop_state',
      info: { active: false, remaining: state.remaining, reason: null },
      previousHostId: null
    })
    this.emitState(created.id, state, previousHostId)
    void created
      .rename(`${state.baseName} (${state.iteration})`)
      .catch(() => {})
      .then(() => created.prompt(state.prompt))
      .then((result) => {
        if (!result.ok) {
          this.states.delete(created.id)
          this.emit(created.id, {
            type: 'loop_state',
            info: { active: false, remaining: state.remaining, reason: 'error' },
            previousHostId: null
          })
          this.emit(created.id, { type: 'turn_error', message: result.error ?? 'Loop iteration failed to start' })
        }
      })
      .catch(() => {})
  }

  private emitState(hostId: string, state: LoopState, previousHostId: string | null): void {
    this.emit(hostId, { type: 'loop_state', info: this.info(state), previousHostId })
  }

  private info(state: LoopState): LoopInfo {
    return { active: state.active, remaining: state.remaining, reason: state.reason }
  }
}

function clampIterations(value: number): number {
  if (!Number.isFinite(value)) return MIN_ITERATIONS
  return Math.min(MAX_ITERATIONS, Math.max(MIN_ITERATIONS, Math.round(value)))
}

/** База имени петли: срезает индекс прошлой петли « (N)», чтобы индексы не наслаивались. */
function cleanLoopTitle(title: string): string {
  const cleaned = title.replace(/\s*\(\d+\)\s*$/, '').trim()
  return cleaned.length > 0 ? cleaned : title.trim()
}
