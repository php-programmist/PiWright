/** Очередь отложенных промптов (очередь сессий): отправка в целевую сессию после хода
 *  сессии-источника или в заданное время. Переживает перезапуск — JSON в userData
 *  (атомарная запись tmp+rename, как в SettingsService). Триггер — turn_end источника
 *  в main-процессе (fan-out рядом с LoopController), renderer для срабатывания не нужен.
 *  Элемент с loop: после отправки стартует петля (LoopController.start до prompt —
 *  контроллер должен увидеть turn_start первого хода). Занятая цель откладывает отправку
 *  до ready: followUp-ход петля не видит (external turn) — петля встанет только на свой ход. */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { PiEventMessage, PiStatus, ScheduledPrompt, SchedulePromptInput, Settings } from '../../shared/ipc-contracts'
import type { PiHost } from '../pi/pi-host'
import type { LoopController } from '../pi/loop-controller'

interface ScheduleFile {
  version: 1
  items: ScheduledPrompt[]
}

/** Максимум Node setTimeout: больше — таймер молча ставится на 1 мс. */
const MAX_TIMEOUT = 2 ** 31 - 1

export class ScheduleService {
  private items: ScheduledPrompt[] = []
  private timers = new Map<string, NodeJS.Timeout>()
  /** Элементы, чья отправка отложена до готовности занятой цели (id → targetHostId). */
  private deferred = new Map<string, string>()

  constructor(
    private readonly filePath: string,
    private readonly piHost: PiHost,
    private readonly loops: LoopController,
    private readonly getSettings: () => Settings,
    private readonly onChange: () => void
  ) {
    this.load()
  }

  list(): ScheduledPrompt[] {
    return [...this.items]
  }

  schedule(input: SchedulePromptInput): { ok: boolean; error: string | null } {
    const target = this.piHost.get(input.targetHostId)
    if (target === null) return { ok: false, error: 'Target session not found' }
    const item: ScheduledPrompt = {
      id: randomUUID(),
      targetHostId: input.targetHostId,
      targetTitle: target.lastStatus()?.title ?? 'Session',
      project: target.project,
      text: input.text,
      images: input.images ?? [],
      model: input.model ?? null,
      thinkingLevel: input.thinkingLevel ?? null,
      trigger: input.trigger,
      loop: input.loop ?? null,
      createdAt: Date.now()
    }
    this.items.push(item)
    this.persist()
    this.arm(item)
    this.onChange()
    return { ok: true, error: null }
  }

  cancel(id: string): { ok: boolean; error: string | null } {
    const removed = this.remove(id)
    return removed ? { ok: true, error: null } : { ok: false, error: 'Scheduled prompt not found' }
  }

  /** Сессия закрылась — снять её отложенные отправки (и как цель, и как источник). */
  forgetHost(hostId: string): void {
    const before = this.items.length
    this.items = this.items.filter((i) => i.targetHostId !== hostId && !(i.trigger.kind === 'after' && i.trigger.sourceHostId === hostId))
    for (const [id, target] of this.deferred) if (target === hostId) this.deferred.delete(id)
    if (this.items.length !== before) {
      this.persist()
      this.onChange()
    }
  }

  /** Fan-out событий pi: turn_end источника запускает его «после…»-отправки.
   *  check-ход петли — внутренний, триггером не считается. */
  onEvent(message: PiEventMessage): void {
    if (message.event.type !== 'turn_end' || message.event.check === true) return
    const due = this.items.filter((i) => i.trigger.kind === 'after' && i.trigger.sourceHostId === message.hostId)
    if (due.length === 0) return
    void this.fireAll(due)
  }

  /** Статусы сессий: готовность занятой цели с отложенной отправкой — пора стрелять. */
  onStatus(status: PiStatus): void {
    if (status.state !== 'ready') return
    const due = this.items.filter((i) => this.deferred.get(i.id) === status.hostId)
    if (due.length === 0) return
    for (const item of due) this.deferred.delete(item.id)
    void this.fireAll(due)
  }

  dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }

  private arm(item: ScheduledPrompt): void {
    if (item.trigger.kind !== 'at') return
    this.armTimer(item.id, item.trigger.atEpochMs)
  }

  /** Node setTimeout при delay > 2^31-1 мс (~24.8 дня) молча ставит таймер на 1 мс —
   *  дальние сроки водим цепочкой таймеров до наступления времени. */
  private armTimer(id: string, atEpochMs: number): void {
    const remaining = atEpochMs - Date.now()
    if (remaining > MAX_TIMEOUT) {
      const timer = setTimeout(() => this.armTimer(id, atEpochMs), MAX_TIMEOUT)
      timer.unref()
      this.timers.set(id, timer)
      return
    }
    const timer = setTimeout(() => {
      this.timers.delete(id)
      if (Date.now() < atEpochMs) {
        this.armTimer(id, atEpochMs)
        return
      }
      void this.fireAll(this.items.filter((i) => i.id === id))
    }, Math.max(0, remaining))
    timer.unref()
    this.timers.set(id, timer)
  }

  private async fireAll(due: ScheduledPrompt[]): Promise<void> {
    for (const item of due) {
      if (this.items.find((i) => i.id === item.id) === undefined) continue
      const target = this.piHost.get(item.targetHostId)
      if (target === null) {
        this.remove(item.id)
        continue
      }
      // Занятая цель: followUp-ход петля не видит (turn_start external) — откладываем до ready.
      if (item.loop !== null && target.streaming) {
        this.deferred.set(item.id, item.targetHostId)
        continue
      }
      this.remove(item.id)
      await this.fire(item, target)
    }
  }

  private async fire(item: ScheduledPrompt, target: NonNullable<ReturnType<PiHost['get']>>): Promise<void> {
    // Настройки применяются только простаивающей цели: set_model/set_thinking_level на живом
    // ходе непредсказуемы; занятая цель получает промпт как followUp с текущими настройками.
    if (!target.streaming) {
      if (item.model !== null) await target.setModel(item.model)
      if (item.thinkingLevel !== null) await target.setThinkingLevel(item.thinkingLevel)
    }
    // Петля поднимается до отправки: prompt резолвится уже после agent_start первого хода,
    // и контроллер не увидел бы его начала (та же последовательность, что в ChatView.send).
    const existingLoop = this.loops.get(item.targetHostId)
    const startingLoop = item.loop !== null && this.getSettings().loopsEnabled && (existingLoop === null || !existingLoop.active)
    if (startingLoop && item.loop !== null) {
      this.loops.start(item.targetHostId, item.text, item.loop.maxIterations, item.loop.exitCondition)
    }
    const result = await target.prompt(item.text, item.images, target.streaming ? 'followUp' : undefined)
    if (!result.ok && startingLoop) this.loops.stop(item.targetHostId)
  }

  private remove(id: string): boolean {
    const before = this.items.length
    this.items = this.items.filter((i) => i.id !== id)
    this.deferred.delete(id)
    const timer = this.timers.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      this.timers.delete(id)
    }
    if (this.items.length !== before) {
      this.persist()
      this.onChange()
      return true
    }
    return false
  }

  private load(): void {
    if (!existsSync(this.filePath)) return
    let items: unknown
    try {
      const raw: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'))
      if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) items = (raw as ScheduleFile).items
    } catch {
      return
    }
    if (!Array.isArray(items)) return
    this.items = items.filter(isScheduledPrompt).map((i) => ({ ...i, loop: i.loop ?? null }))
    for (const item of this.items) this.arm(item)
    // Просроченные за время простоя приложения — отправляем сразу (как отложенные в Telegram).
    const overdue = this.items.filter((i) => i.trigger.kind === 'at' && i.trigger.atEpochMs <= Date.now())
    if (overdue.length > 0) void this.fireAll(overdue)
  }

  private persist(): void {
    const data: ScheduleFile = { version: 1, items: this.items }
    mkdirSync(dirname(this.filePath), { recursive: true })
    const tmp = `${this.filePath}.tmp`
    writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
    renameSync(tmp, this.filePath)
  }
}

function isScheduledPrompt(value: unknown): value is ScheduledPrompt {
  if (value === null || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  if (typeof v['id'] !== 'string' || typeof v['targetHostId'] !== 'string' || typeof v['text'] !== 'string') return false
  if (typeof v['targetTitle'] !== 'string' || !Array.isArray(v['images'])) return false
  const trigger = v['trigger']
  if (trigger === null || typeof trigger !== 'object') return false
  const t = trigger as Record<string, unknown>
  if (t['kind'] === 'after') {
    if (typeof t['sourceHostId'] !== 'string' || typeof t['sourceTitle'] !== 'string') return false
  } else if (t['kind'] === 'at') {
    if (typeof t['atEpochMs'] !== 'number' || !Number.isFinite(t['atEpochMs'])) return false
  } else {
    return false
  }
  const loop = v['loop']
  if (loop !== null && loop !== undefined) {
    if (typeof loop !== 'object') return false
    const l = loop as Record<string, unknown>
    if (typeof l['maxIterations'] !== 'number' || !Number.isFinite(l['maxIterations'])) return false
    if (typeof l['exitCondition'] !== 'string') return false
  }
  return true
}
