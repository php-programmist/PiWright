/** Контроллер петли PiWright: продолжение решает харнесс, а не агент. Когда рабочий ход
 *  завершился с вызовами инструментов, харнесс шлёт в ту же сессию check-промпт «выполнено ли
 *  условие выхода»: ход с loop_stop = петля остановлена, ход без — спавнится новая сессия
 *  того же проекта с тем же промптом. Условие выхода необязательно: без него check-промпт
 *  не отправляется, рабочая итерация сразу продолжается спавном новой сессии. Рабочий ход
 *  без инструментов = стоп. Ход с ожидающим
 *  диалогом или работающими субагентами/воркфлоу продолжения не получает, пока не разрешились.
 *  Ход, закончившийся ошибкой модели (turn_end.error), останавливает петлю с reason 'error' —
 *  сессия не закрывается, продолжение вручную.
 *  Детач-аттач (крестик вкладки во время хода, keepAlive): состояние активной петли
 *  отвязывается по файлу сессии (detach) и возвращается при переоткрытии вкладки (reattach);
 *  первый статус сессии решает — ход ещё идёт (дослеживаем) или уже дозрел в фоне (цикл
 *  продолжается: check-промпт или спавн). Активные петли персистятся в настройки
 *  (settings.loops) — переживают и рестарт приложения (восстановление открытых вкладок).
 *  Спавн в worktree-сессии: перед create ветка worktree синкается merge'ем с базовой (ветка
 *  корневого checkout'а), а промпт итерации получает префикс «ты в worktree …» — без этого
 *  агент с чистым контекстом видит устаревший код и создаёт свой worktree.
 *  SessionHost откладывает turn_end рабочего хода при живых субагентах — первым turn_end после
 *  них приходит ход-нудж субагента, он и разрешает рабочий ход.
 *  Страховки: счётчик итераций, 3 итерации подряд быстрее 10 с, снятый чекбокс / закрытие,
 *  watchdog на ход, который не разрешился ни по одному из путей. */
import type { LoopInfo, LoopStopReason, UiEvent } from '../../shared/agent-events'
import type { PersistedLoop, PiEventMessage, PiStatus, ProjectEntry } from '../../shared/ipc-contracts'
import { splitWorktreeHostDir, worktreeBranchFor } from '../../shared/worktree'
import type { PiHost } from './pi-host'
import { LOOP_STOP_TOOL_NAME } from './loop-stop-extension'

/** Синк worktree-ветки с базовой перед спавном итерации (GitService.worktreeMergeBase). */
export type LoopWorktreeSync = (project: ProjectEntry) => Promise<{ ok: boolean; error: string | null }>

const SHORT_CIRCUIT_CALLS = 3
const SHORT_CIRCUIT_GAP_MS = 10_000
/** Событие subagents:started может прийти после turn_end (спавн ушел асинхронно) — столько ждём его перед check-промптом. */
const SUBAGENT_GRACE_MS = 2000
/** Потерянное событие разрешения хода: сессия уже в ready, а петля ход всё ещё не закрыла. */
const TURN_RESOLVE_WATCHDOG_MS = 15_000
const MIN_ITERATIONS = 1
const MAX_ITERATIONS = 999

interface LoopState {
  prompt: string
  /** Условие выхода петли: проверяется check-промптом после каждого рабочего хода; пустое — петля без условия, выход только по лимиту итераций. */
  exitCondition: string
  remaining: number
  active: boolean
  reason: LoopStopReason | null
  project: ProjectEntry
  /** Времена последних спавнов — для «короткого замыкания» (3 быстрее 10 с). */
  spawnTimes: number[]
  /** Был ли в текущем ходе хотя бы один вызов инструмента верхнего уровня. */
  toolSeenThisTurn: boolean
  /** Агент вызвал loop_stop в текущем ходе. */
  stopRequested: boolean
  /** Текущий ход — check-ход (проверка условия выхода), а не рабочий. */
  checkingCondition: boolean
  /** turn_end этого хода уже разрешён (стоп/спавн/check отправлен) — дубликат agent_end/agent_settled гасим. */
  turnEndHandled: boolean
  /** Обработка конца хода начата (грейс-пауза/дефер) — повторный turn_end этого же хода гасим. */
  turnEndPending: boolean
  /** Идёт внешний ход (nudge субагента/follow_up) — в логике петли не участвует. */
  externalTurn: boolean
  /** Рабочий ход начат и ещё не разрешён — конец внешнего хода доводит его до check/спавна. */
  workTurnOpen: boolean
  /** Ход завершился, но в фоне ещё работают субагенты/воркфлоу — ждём их завершения. */
  waitingSubagents: boolean
  /** Ошибка модели текущего хода (turn_end.error) — петля останавливается с reason 'error'. */
  turnError: string | null
  /** Активные субагенты (subagents:created/started … completed/failed). */
  subagents: Set<string>
  /** Активные воркфлоу (subagents:workflow_started … workflow_settled). */
  workflows: Set<string>
  /** Отложенный check-промпт: таймер грейс-паузы перед отправкой. */
  checkTimer: ReturnType<typeof setTimeout> | null
  /** Страховой таймер: ход открыт, а сессия уже вернулась в ready. */
  resolveWatchdog: ReturnType<typeof setTimeout> | null
  /** Номер текущей итерации (стартовая сессия = 1); растёт с каждым спавном. */
  iteration: number
  /** Имя стартовой сессии без индекса — база для имён «имя (2)», «имя (3)»… */
  baseName: string
  /** Последний hostId, под которым состояние было в states (для carry-over флагов рендерера при реаттаче). */
  lastHostId: string
  /** Последний известный файл сессии текущей итерации — ключ восстановления из настроек. */
  lastSessionFile: string | null
  /** Состояние восстановлено (детач-аттач/рестарт) и ждёт первого статуса сессии, чтобы
   *  решить: ход ещё идёт (дослеживаем) или уже завершился в фоне (продолжаем цикл). */
  pendingAttach: boolean
}

export class LoopController {
  private readonly states = new Map<string, LoopState>()
  /** Петли отвязанных сессий (крестик вкладки во время хода): файл сессии → состояние.
   *  Живут до реаттача той же сессии; в persist() участвуют наравне с активными. */
  private readonly detached = new Map<string, LoopState>()

  constructor(
    private readonly piHost: PiHost,
    private readonly emit: (hostId: string, event: UiEvent) => void,
    /** Мост для копирования флагов прошлой сессии (Remote, Telegram) в новую. */
    private readonly onSpawned?: (previousHostId: string, createdHostId: string) => void,
    /** Грейс-пауза перед check-промптом (переопределяется в тестах). */
    private readonly graceMs: number = SUBAGENT_GRACE_MS,
    /** Пауза watchdog перед форс-разрешением хода (переопределяется в тестах). */
    private readonly resolveWatchdogMs: number = TURN_RESOLVE_WATCHDOG_MS,
    /** Синк worktree-ветки перед спавном итерации; undefined — спавн без синка. */
    private readonly syncWorktree?: LoopWorktreeSync,
    /** Персист активных петель в настройки — пережить детач-аттач и рестарт приложения. */
    private readonly persistLoops?: (loops: PersistedLoop[]) => void,
    /** Активные петли из настроек — источник восстановления, когда в памяти detached-состояния нет. */
    private readonly getPersistedLoops?: () => PersistedLoop[]
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
      stopRequested: false,
      checkingCondition: false,
      turnEndHandled: false,
      turnEndPending: false,
      externalTurn: false,
      workTurnOpen: false,
      waitingSubagents: false,
      turnError: null,
      checkTimer: null,
      resolveWatchdog: null,
      subagents: new Set(),
      workflows: new Set(),
      iteration: 1,
      baseName: cleanLoopTitle(host.displayTitle),
      lastHostId: hostId,
      lastSessionFile: host.sessionFilePath,
      pendingAttach: false
    }
    this.states.set(hostId, state)
    this.emitState(hostId, state, null)
    this.persistNow()
    return this.info(state)
  }

  stop(hostId: string): LoopInfo | null {
    const state = this.states.get(hostId)
    if (state === undefined) return null
    this.clearCheckTimer(state)
    this.clearResolveWatchdog(state)
    state.active = false
    state.reason = 'user'
    this.emitState(hostId, state, null)
    this.persistNow()
    return this.info(state)
  }

  setRemaining(hostId: string, remaining: number): LoopInfo | null {
    const state = this.states.get(hostId)
    if (state === undefined) return null
    state.remaining = clampIterations(remaining)
    this.emitState(hostId, state, null)
    this.persistNow()
    return this.info(state)
  }

  get(hostId: string): LoopInfo | null {
    const state = this.states.get(hostId)
    return state === undefined ? null : this.info(state)
  }

  forget(hostId: string): void {
    const state = this.states.get(hostId)
    if (state !== undefined) {
      this.clearCheckTimer(state)
      this.clearResolveWatchdog(state)
    }
    this.states.delete(hostId)
    this.persistNow()
  }

  /** Крестик вкладки (keepAlive): состояние активной петли не выбрасываем, а отвязываем —
   *  по файлу сессии она будет восстановлена при переоткрытии вкладки (или после рестарта
   *  приложения — из настроек). Без файла сессии (локальный спавн без демона) петля умирает. */
  detach(hostId: string): void {
    const state = this.states.get(hostId)
    if (state === undefined) return
    this.clearCheckTimer(state)
    this.clearResolveWatchdog(state)
    this.states.delete(hostId)
    if (!state.active) {
      this.persistNow()
      return
    }
    const file = this.piHost.get(hostId)?.sessionFilePath ?? null
    if (file !== null) state.lastSessionFile = file
    if (state.lastSessionFile === null) {
      this.persistNow()
      return
    }
    this.detached.set(state.lastSessionFile, state)
    this.persistNow()
  }

  /** Переоткрытие вкладки (аттач): вернуть петлю под новым hostId. Источник — в памяти
   *  (detached), иначе настройки (рестарт приложения). Дальнейшее решает onStatus.
   *  Петля под этим файлом уже живёт (сессию открыли второй раз) — не дублируем. */
  reattach(sessionFile: string, hostId: string): void {
    for (const state of this.states.values()) {
      if (state.active && state.lastSessionFile === sessionFile) return
    }
    const memory = this.detached.get(sessionFile)
    const state = memory ?? this.stateFromPersisted(this.getPersistedLoops?.().find((l) => l.sessionFile === sessionFile))
    if (state === null) return
    this.detached.delete(sessionFile)
    const previousHostId = memory !== undefined ? state.lastHostId : null
    state.lastHostId = hostId
    state.pendingAttach = true
    this.states.set(hostId, state)
    this.emit(hostId, { type: 'loop_state', info: this.info(state), previousHostId })
    this.persistNow()
  }

  /** Файл сессии текущей итерации стал известен (хендшейк/форк) — обновляем ключ персиста. */
  noteSessionFile(hostId: string, sessionFile: string): void {
    const state = this.states.get(hostId)
    if (state === undefined || state.lastSessionFile === sessionFile) return
    state.lastSessionFile = sessionFile
    this.persistNow()
  }

  /** Первый статус после реаттача решает судьбу восстановленной петли: ход ещё идёт —
   *  дослеживаем (оптимистично считаем рабочим с инструментами: ход начался до аттача,
   *  его turn_start петля не видела); сессия уже ready — ход завершился в фоне, продолжаем
   *  цикл как после turn_end; ошибка старта — петля останавливается. */
  onStatus(status: PiStatus): void {
    const state = this.states.get(status.hostId)
    if (state === undefined || !state.pendingAttach) return
    if (status.state === 'idle' || status.state === 'starting') return
    state.pendingAttach = false
    if (!state.active) return
    if (status.state === 'streaming' || status.state === 'waiting') {
      state.workTurnOpen = true
      state.toolSeenThisTurn = true
      return
    }
    if (status.state === 'ready') {
      if (state.remaining <= 0) {
        this.stopLoop(status.hostId, state, 'max')
        return
      }
      if (this.isShortCircuit(state)) {
        this.stopLoop(status.hostId, state, 'short-circuit')
        return
      }
      if (state.exitCondition.trim().length === 0) {
        this.spawnNext(status.hostId, state)
        return
      }
      this.scheduleCheck(status.hostId, state)
      return
    }
    this.stopLoop(status.hostId, state, 'error')
  }

  /** Настройка «Петли» выключена — гасим все активные петли, включая отвязанные. */
  stopAll(): void {
    for (const [hostId, state] of this.states) {
      this.clearCheckTimer(state)
      this.clearResolveWatchdog(state)
      if (!state.active) continue
      state.active = false
      state.reason = 'user'
      this.emitState(hostId, state, null)
    }
    if (this.detached.size > 0) this.detached.clear()
    this.persistNow()
  }

  onEvent(message: PiEventMessage): void {
    const state = this.states.get(message.hostId)
    if (state === undefined) return
    this.dispatch(message.hostId, state, message.event)
    this.updateResolveWatchdog(message.hostId, state)
  }

  private dispatch(hostId: string, state: LoopState, event: UiEvent): void {
    if (event.type === 'tool_start') {
      if (event.call.parentToolCallId !== null) return
      if (state.externalTurn) return
      state.toolSeenThisTurn = true
      if (event.call.name === LOOP_STOP_TOOL_NAME) state.stopRequested = true
      return
    }
    if (event.type === 'turn_start') {
      const attachResume = state.pendingAttach
      state.pendingAttach = false
      if (event.external === true) {
        if (attachResume) {
          // Реаттач посреди рабочего хода: синтетический external turn_start от SessionHost —
          // ход начался до аттача; возобновляем его как рабочий (как onStatus streaming).
          if (state.active) {
            state.workTurnOpen = true
            state.toolSeenThisTurn = true
          }
          return
        }
        // Внешний ход (nudge субагента) поверх петли: флаги рабочего хода и запланированный
        // check не трогаем, ход целиком игнорируем вплоть до его turn_end.
        state.externalTurn = true
        state.turnEndPending = true
        return
      }
      this.clearCheckTimer(state)
      state.externalTurn = false
      state.workTurnOpen = true
      state.toolSeenThisTurn = false
      state.stopRequested = false
      state.waitingSubagents = false
      state.turnEndHandled = false
      state.turnEndPending = false
      state.turnError = null
      return
    }
    if (event.type === 'subagents_activity') {
      this.onSubagentsActivity(hostId, state, event.kind, event.id)
      return
    }
    if (event.type === 'turn_end') {
      if (event.error != null) state.turnError = event.error
      this.onTurnEnd(hostId, state)
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
    if (state.externalTurn) {
      // Петля внешнего хода не видела; снятый флаг гасит дубль его turn_end.
      state.externalTurn = false
      if (!state.workTurnOpen) return
      // Рабочий ход завершился при живых субагентах — SessionHost свой turn_end не прислал,
      // и единственный turn_end в цепочке принадлежит ходу-нуджу. Разрешаем рабочий ход им.
      state.turnEndPending = false
    }
    // agent_end и agent_settled дают два turn_end — второй гасим; повторная обработка
    // после сброса toolSeenThisTurn ошибочно стопила бы петлю с reason 'agent'.
    if (state.turnEndHandled || state.turnEndPending) return
    state.turnEndPending = true
    if (state.subagents.size > 0 || state.workflows.size > 0) {
      state.waitingSubagents = true
      return
    }
    this.proceedTurnEnd(hostId, state)
  }

  private proceedTurnEnd(hostId: string, state: LoopState): void {
    // Ход закончился ошибкой модели — петля останавливается, сессия остаётся открытой:
    // юзер чинит ошибку и продолжает вручную.
    if (state.turnError !== null) {
      state.turnEndHandled = true
      state.workTurnOpen = false
      state.checkingCondition = false
      if (state.active) this.stopLoop(hostId, state, 'error')
      return
    }
    // turnEndHandled ставится только в точках разрешения хода (стоп/спавн/отправка check) —
    // грейс-пауза и дефер по субагентам ход ещё не разрешают.
    if (state.checkingCondition) {
      if (state.turnEndHandled) return
      state.turnEndHandled = true
      state.workTurnOpen = false
      state.checkingCondition = false
      state.toolSeenThisTurn = false
      if (state.stopRequested) {
        this.stopLoop(hostId, state, 'exit')
        return
      }
      this.spawnNext(hostId, state)
      return
    }
    if (!state.toolSeenThisTurn || state.stopRequested) {
      // Рабочий ход без единого вызова инструмента — агенту нечего продолжать;
      // loop_stop в рабочем ходу — агент сам понял, что условие выхода выполнено.
      state.turnEndHandled = true
      state.workTurnOpen = false
      if (state.active) this.stopLoop(hostId, state, state.stopRequested ? 'exit' : 'agent')
      return
    }
    if (!state.active) return
    if (state.remaining <= 0) {
      state.turnEndHandled = true
      state.workTurnOpen = false
      this.stopLoop(hostId, state, 'max')
      return
    }
    if (this.isShortCircuit(state)) {
      state.turnEndHandled = true
      state.workTurnOpen = false
      this.stopLoop(hostId, state, 'short-circuit')
      return
    }
    if (state.exitCondition.trim().length === 0) {
      // Условие выхода не задано — check-промпт не нужен, итерация сразу продолжается спавном.
      state.turnEndHandled = true
      state.workTurnOpen = false
      state.toolSeenThisTurn = false
      this.spawnNext(hostId, state)
      return
    }
    this.scheduleCheck(hostId, state)
  }

  /** Check-промпт уходит с задержкой graceMs: спавн субагента уходит асинхронно, и
   *  subagents:started часто приходит после turn_end — без паузы check уходит при живом субагенте. */
  private scheduleCheck(hostId: string, state: LoopState): void {
    this.clearCheckTimer(state)
    state.checkTimer = setTimeout(() => {
      state.checkTimer = null
      if (this.states.get(hostId) !== state || !state.active) return
      // Внешний ход ещё стримится — prompt ушёл бы в очередь pi; переносим отправку.
      if (state.externalTurn) {
        this.scheduleCheck(hostId, state)
        return
      }
      if (state.subagents.size > 0 || state.workflows.size > 0) {
        state.waitingSubagents = true
        return
      }
      state.turnEndHandled = true
      state.workTurnOpen = false
      state.toolSeenThisTurn = false
      this.sendCheckPrompt(hostId, state)
    }, this.graceMs)
  }

  private clearCheckTimer(state: LoopState): void {
    if (state.checkTimer !== null) {
      clearTimeout(state.checkTimer)
      state.checkTimer = null
    }
  }

  /** Событие разрешения хода пропало (потерянный completed/turn_end, ранняя отсечка в
   *  обработчике) — ход остаётся открытым уже после того, как сессия вернулась в ready.
   *  Пока рабочий ход открыт, watchdog периодически это проверяет и дожимает разрешение.
   *  Пауза в грейс-окне — не зависание: там уже стоит checkTimer. */
  private updateResolveWatchdog(hostId: string, state: LoopState): void {
    if (this.states.get(hostId) !== state || !state.active) {
      this.clearResolveWatchdog(state)
      return
    }
    if (!state.workTurnOpen || state.turnEndHandled) {
      this.clearResolveWatchdog(state)
      return
    }
    this.armResolveWatchdog(hostId, state)
  }

  private armResolveWatchdog(hostId: string, state: LoopState): void {
    if (state.resolveWatchdog !== null) return
    state.resolveWatchdog = setTimeout(() => {
      state.resolveWatchdog = null
      if (this.states.get(hostId) !== state || !state.active) return
      if (!state.workTurnOpen || state.turnEndHandled) return
      if (this.isTurnResolutionOwed(hostId, state)) {
        state.subagents.clear()
        state.workflows.clear()
        state.waitingSubagents = false
        this.emit(hostId, {
          type: 'notify',
          message: 'loop: turn resolved by watchdog',
          isError: true
        })
        this.proceedTurnEnd(hostId, state)
        return
      }
      // Ход ещё живёт (стримится или ждутся субагенты) — следующая проверка через тот же интервал.
      this.armResolveWatchdog(hostId, state)
    }, this.resolveWatchdogMs)
    state.resolveWatchdog.unref()
  }

  /** Петля должна ходу финал, а ждать его больше не от чего: разрешение не отправлено,
   *  грейс-таймера нет, сессия уже вернулась в ready. */
  private isTurnResolutionOwed(hostId: string, state: LoopState): boolean {
    if (state.checkTimer !== null) return false
    const status = this.piHost.get(hostId)?.lastStatus?.()
    return status?.state === 'ready'
  }

  private clearResolveWatchdog(state: LoopState): void {
    if (state.resolveWatchdog !== null) {
      clearTimeout(state.resolveWatchdog)
      state.resolveWatchdog = null
    }
  }

  private stopLoop(hostId: string, state: LoopState, reason: LoopStopReason): void {
    this.clearCheckTimer(state)
    state.active = false
    state.reason = reason
    this.emitState(hostId, state, null)
    this.persistNow()
  }

  /** Check-ход: агент в той же сессии проверяет условие выхода — у него весь контекст работы. */
  private sendCheckPrompt(hostId: string, state: LoopState): void {
    state.checkingCondition = true
    const host = this.piHost.get(hostId)
    if (host === null) {
      state.checkingCondition = false
      this.spawnNext(hostId, state)
      return
    }
    host.markCheckTurn()
    void host
      .prompt(checkPrompt(state.exitCondition))
      .then((result) => {
        if (!result.ok && this.states.get(hostId) === state && state.checkingCondition) {
          state.checkingCondition = false
          this.stopLoop(hostId, state, 'error')
        }
      })
      .catch(() => {
        if (this.states.get(hostId) === state && state.checkingCondition) {
          state.checkingCondition = false
          this.stopLoop(hostId, state, 'error')
        }
      })
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
    this.clearResolveWatchdog(state)
    state.remaining -= 1
    state.iteration += 1
    state.spawnTimes.push(Date.now())
    if (state.spawnTimes.length > SHORT_CIRCUIT_CALLS) state.spawnTimes.shift()
    this.emit(previousHostId, {
      type: 'loop_state',
      info: { active: false, remaining: state.remaining, reason: null },
      previousHostId: null
    })
    void this.spawnCreated(previousHostId, state)
  }

  /** Спавн итерации: в worktree-сессии перед create синк ветки с базовой (merge) — иначе агент
   *  итерации видит устаревший код и выходит из worktree. Стоп/закрытие во время синка —
   *  спавн отменяется. Не-удавшийся синк не блокирует итерацию: спавн как есть + уведомление. */
  private async spawnCreated(previousHostId: string, state: LoopState): Promise<void> {
    const wt = splitWorktreeHostDir(state.project.dir)
    let syncError: string | null = null
    if (wt !== null && this.syncWorktree !== undefined) {
      const synced = await this.syncWorktree(state.project)
      if (!synced.ok) syncError = synced.error
    }
    if (this.states.get(previousHostId) !== state || !state.active) return
    const parent = this.piHost.get(previousHostId)
    const parentStatus = parent?.lastStatus()
    const created = this.piHost.create(state.project, undefined, {
      model: parentStatus?.model ?? null,
      thinkingLevel: parentStatus?.thinkingLevel ?? null
    })
    this.states.delete(previousHostId)
    // Файл родителя больше не ключ этой петли: итерация — новая сессия, её файл придёт
    // с хендшейком (noteSessionFile). До тех пор в настройках петля восстанавлению не подлежит.
    state.lastHostId = created.id
    state.lastSessionFile = null
    this.states.set(created.id, state)
    this.onSpawned?.(previousHostId, created.id)
    this.emitState(created.id, state, previousHostId)
    this.persistNow()
    if (syncError !== null) {
      this.emit(created.id, {
        type: 'notify',
        message: `loop: worktree branch sync failed: ${syncError}`,
        isError: true
      })
    }
    const promptText = wt !== null ? worktreePromptNotice(wt.name) + state.prompt : state.prompt
    void created
      .rename(`${state.baseName} (${state.iteration})`)
      .catch(() => {})
      .then(() => created.prompt(promptText))
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

  /** Активные петли (включая отвязанные) для настроек; без файла сессии восстановление невозможно. */
  private persisted(): PersistedLoop[] {
    const out: PersistedLoop[] = []
    for (const state of [...this.states.values(), ...this.detached.values()]) {
      if (!state.active || state.lastSessionFile === null) continue
      out.push({
        sessionFile: state.lastSessionFile,
        project: state.project,
        prompt: state.prompt,
        exitCondition: state.exitCondition,
        remaining: state.remaining,
        iteration: state.iteration,
        baseName: state.baseName
      })
    }
    return out
  }

  private persistNow(): void {
    this.persistLoops?.(this.persisted())
  }

  /** Состояние из настроек (после рестарта приложения): ходовые флаги чистые, дальше решает onStatus. */
  private stateFromPersisted(saved: PersistedLoop | undefined): LoopState | null {
    if (saved === undefined) return null
    return {
      prompt: saved.prompt,
      exitCondition: saved.exitCondition,
      // remaining 0 валиден (итерация заспавнена, лимит исчерпан) — clamp с минимумом 1 тут не нужен.
      remaining: Math.min(MAX_ITERATIONS, Math.max(0, Math.round(saved.remaining))),
      active: true,
      reason: null,
      project: saved.project,
      spawnTimes: [],
      toolSeenThisTurn: false,
      stopRequested: false,
      checkingCondition: false,
      turnEndHandled: false,
      turnEndPending: false,
      externalTurn: false,
      workTurnOpen: false,
      waitingSubagents: false,
      turnError: null,
      checkTimer: null,
      resolveWatchdog: null,
      subagents: new Set(),
      workflows: new Set(),
      iteration: Math.max(1, Math.round(saved.iteration)),
      baseName: saved.baseName,
      lastHostId: '',
      lastSessionFile: saved.sessionFile,
      pendingAttach: true
    }
  }
}

/** Check-промпт: агент только что закончил рабочий ход — контекст у него есть. */
function checkPrompt(exitCondition: string): string {
  return `Проверь условие выхода из петли: «${exitCondition}». Если оно ВЫПОЛНЕНО — вызови инструмент loop_stop и заверши ход. Если НЕ выполнено — ответь одним коротким предложением, что условие пока не выполнено, БЕЗ вызова каких-либо инструментов.`
}

/** Префикс промпта итерации в worktree-сессии: агент стартует с чистым контекстом и не знает,
 *  что cwd — управляемый PiWright worktree; без подсказки он может создать свой. */
function worktreePromptNotice(name: string): string {
  return `Ты в git worktree «${name}» (ветка ${worktreeBranchFor(name)}) — его создала PiWright для этой серии сессий. Работай в нём: изменения и коммиты — в эту ветку; новые worktree не создавай, ветки не переключай.\n\n`
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
