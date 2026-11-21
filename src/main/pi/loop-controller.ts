/** Контроллер петли PiWright: продолжение решает харнесс, а не агент. Когда ход завершился
 *  и в нём были вызовы инструментов, спавнится новая сессия того же проекта с тем же промптом.
 *  Ход без вызовов инструментов = петля завершена. Ход с ожидающим диалогом или работающими
 *  субагентами/воркфлоу продолжения не получает, пока они не разрешились. Страховки: счётчик
 *  итераций, 3 итерации подряд быстрее 10 с, снятый чекбокс / закрытие сессии. */
import type { LoopInfo, LoopStopReason, UiEvent } from '../../shared/agent-events'
import { loopExitClause } from '../../shared/agent-events'
import type { PiEventMessage, ProjectEntry } from '../../shared/ipc-contracts'
import type { PiHost } from './pi-host'
import { LOOP_STOP_TOOL_NAME } from './loop-stop-extension'

const SHORT_CIRCUIT_CALLS = 3
const SHORT_CIRCUIT_GAP_MS = 10_000
const MIN_ITERATIONS = 1
const MAX_ITERATIONS = 999

interface LoopState {
  prompt: string
  /** Условие выхода из петли: дописывается в промпт каждой итерации; ход без инструментов = стоп. */
  exitCondition: string
  remaining: number
  active: boolean
  reason: LoopStopReason | null
  project: ProjectEntry
  /** Времена последних спавнов — для «короткого замыкания» (3 быстрее 10 с). */
  spawnTimes: number[]
  /** Был ли в текущем ходе хотя бы один вызов инструмента верхнего уровня. */
  toolSeenThisTurn: boolean
  /** Ход завершился, но в фоне ещё работают субагенты/воркфлоу — ждём их завершения. */
  waitingSubagents: boolean
  /** Агент вызвал loop_stop — условие выхода выполнено, после хода петля останавливается. */
  stopRequested: boolean
  /** Активные субагенты (subagents:created/started … completed/failed). */
  subagents: Set<string>
  /** Активные воркфлоу (subagents:workflow_started … workflow_settled). */
  workflows: Set<string>
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

  start(hostId: string, prompt: string, maxIterations: number, exitCondition: string): LoopInfo | null {
    const host = this.piHost.get(hostId)
    if (host === null) return null
    const state: LoopState = {
      prompt,
      exitCondition,
      remaining: clampIterations(maxIterations),
      active: true,
      reason: null,
      project: host.project,
      spawnTimes: [],
      toolSeenThisTurn: false,
      waitingSubagents: false,
      stopRequested: false,
      subagents: new Set(),
      workflows: new Set(),
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
    if (event.type === 'tool_start') {
      if (event.call.parentToolCallId !== null) return
      state.toolSeenThisTurn = true
      if (event.call.name === LOOP_STOP_TOOL_NAME) state.stopRequested = true
      return
    }
    if (event.type === 'turn_start') {
      state.toolSeenThisTurn = false
      state.stopRequested = false
      state.waitingSubagents = false
      return
    }
    if (event.type === 'subagents_activity') {
      this.onSubagentsActivity(message.hostId, state, event.kind, event.id)
      return
    }
    if (event.type === 'turn_end') {
      this.onTurnEnd(message.hostId, state)
    }
  }

  /** Субагенты/воркфлоу: ход ждать не может — ждёт контроллер. */
  private onSubagentsActivity(
    hostId: string,
    state: LoopState,
    kind: 'started' | 'completed' | 'workflow_started' | 'workflow_settled' | 'disposed',
    id: string | null
  ): void {
    if (kind === 'disposed') {
      state.subagents.clear()
      state.workflows.clear()
    } else if (kind === 'started') {
      if (id !== null) state.subagents.add(id)
    } else if (kind === 'completed') {
      if (id !== null) state.subagents.delete(id)
    } else if (kind === 'workflow_started') {
      if (id !== null) state.workflows.add(id)
    } else if (kind === 'workflow_settled') {
      if (id !== null) state.workflows.delete(id)
    }
    if (state.waitingSubagents && state.subagents.size === 0 && state.workflows.size === 0) {
      state.waitingSubagents = false
      this.proceedTurnEnd(hostId, state)
    }
  }

  private onTurnEnd(hostId: string, state: LoopState): void {
    // Ожидающий диалог (ask_question/confirm) — агент приостановлен и продолжит ход после ответа.
    const host = this.piHost.get(hostId)
    if (host !== null && host.getPendingDialogs().length > 0) return
    if (state.subagents.size > 0 || state.workflows.size > 0) {
      state.waitingSubagents = true
      return
    }
    this.proceedTurnEnd(hostId, state)
  }

  private proceedTurnEnd(hostId: string, state: LoopState): void {
    // turn_end приходит и на agent_end, и на agent_settled — флаг гасит двойной спавн.
    if (!state.toolSeenThisTurn || state.stopRequested) {
      // Ход без единого вызова инструмента — агенту нечего продолжать; loop_stop — условие
      // выхода выполнено, агент попросил остановиться.
      if (state.active) {
        state.active = false
        state.reason = state.stopRequested ? 'exit' : 'agent'
        this.emitState(hostId, state, null)
      }
      return
    }
    state.toolSeenThisTurn = false
    if (!state.active) return
    if (state.remaining <= 0) {
      state.active = false
      state.reason = 'max'
      this.emitState(hostId, state, null)
      return
    }
    if (this.isShortCircuit(state)) {
      state.active = false
      state.reason = 'short-circuit'
      this.emitState(hostId, state, null)
      return
    }
    this.spawnNext(hostId, state)
  }

  /** Три спавна подряд с интервалом < 10 с — петля крутится вхолостую. */
  private isShortCircuit(state: LoopState): boolean {
    if (state.spawnTimes.length < SHORT_CIRCUIT_CALLS - 1) return false
    const times = [...state.spawnTimes, Date.now()].slice(-SHORT_CIRCUIT_CALLS)
    if (times.length < SHORT_CIRCUIT_CALLS) return false
    for (let i = 1; i < times.length; i++) {
      if (times[i] - times[i - 1] >= SHORT_CIRCUIT_GAP_MS) return false
    }
    return true
  }

  private spawnNext(previousHostId: string, state: LoopState): void {
    state.remaining -= 1
    state.iteration += 1
    state.spawnTimes.push(Date.now())
    if (state.spawnTimes.length > SHORT_CIRCUIT_CALLS) state.spawnTimes.shift()
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
      .then(() => created.prompt(loopIterationPrompt(state)))
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

/** Промпт итерации: задача + условие выхода. Стоп-механика петли — ход без вызовов
 *  инструментов, поэтому агент обязан завершить ход текстом, когда условие выполнено. */
function loopIterationPrompt(state: LoopState): string {
  return `${state.prompt}\n\n${loopExitClause(state.exitCondition)}`
}
