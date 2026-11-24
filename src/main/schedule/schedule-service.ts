/** Очередь отложенных промптов (очередь сессий): отправка в целевую сессию после хода
 *  сессии-источника или в заданное время. Переживает перезапуск — JSON в userData
 *  (атомарная запись tmp+rename, как в SettingsService). Триггер — turn_end источника
 *  в main-процессе (fan-out рядом с LoopController), renderer для срабатывания не нужен. */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { PiEventMessage, ScheduledPrompt, SchedulePromptInput } from '../../shared/ipc-contracts'
import type { PiHost } from '../pi/pi-host'

interface ScheduleFile {
  version: 1
  items: ScheduledPrompt[]
}

/** Максимум Node setTimeout: больше — таймер молча ставится на 1 мс. */
const MAX_TIMEOUT = 2 ** 31 - 1

export class ScheduleService {
  private items: ScheduledPrompt[] = []
  private timers = new Map<string, NodeJS.Timeout>()

  constructor(
    private readonly filePath: string,
    private readonly piHost: PiHost,
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
      this.remove(item.id)
      await this.fire(item)
    }
  }

  private async fire(item: ScheduledPrompt): Promise<void> {
    const target = this.piHost.get(item.targetHostId)
    if (target === null) return
    // Настройки применяются только простаивающей цели: set_model/set_thinking_level на живом
    // ходе непредсказуемы; занятая цель получает промпт как followUp с текущими настройками.
    if (!target.streaming) {
      if (item.model !== null) await target.setModel(item.model)
      if (item.thinkingLevel !== null) await target.setThinkingLevel(item.thinkingLevel)
    }
    await target.prompt(item.text, item.images, target.streaming ? 'followUp' : undefined)
  }

  private remove(id: string): boolean {
    const before = this.items.length
    this.items = this.items.filter((i) => i.id !== id)
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
    this.items = items.filter(isScheduledPrompt)
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
  if (t['kind'] === 'after') return typeof t['sourceHostId'] === 'string' && typeof t['sourceTitle'] === 'string'
  if (t['kind'] === 'at') return typeof t['atEpochMs'] === 'number' && Number.isFinite(t['atEpochMs'])
  return false
}
