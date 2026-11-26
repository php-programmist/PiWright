import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearBackgroundWatchdogs, rearmBackgroundWatchdogs } from '../src/renderer/src/lib/background-watchdog'
import { useSessionsStore, type SessionRow } from '../src/renderer/src/stores/sessions'
import type { PiStatus, ProjectEntry, Settings } from '../src/shared/ipc-contracts'

/** Вотчдог завершённых фоновых сессий: строка уходит в историю после грейса простоя. */

const project: ProjectEntry = { kind: 'native', dir: 'D:\\tmp\\proj' }

function seedRow(overrides: Partial<SessionRow>): void {
  const base: SessionRow = {
    hostId: 'h1',
    project,
    title: 't',
    dot: 'idle',
    state: 'ready',
    sessionId: null,
    sessionFile: null,
    telegram: false,
    shared: false,
    background: true
  }
  useSessionsStore.setState({ active: [{ ...base, ...overrides }] })
}

function status(overrides: Partial<PiStatus>): PiStatus {
  return {
    hostId: 'h1',
    state: 'ready',
    backend: null,
    model: null,
    sessionId: null,
    sessionFile: null,
    error: null,
    models: [],
    thinkingLevels: [],
    thinkingLevel: null,
    project,
    title: 't',
    dot: 'idle',
    ...overrides
  }
}

function stubPiwright(): { closeSession: ReturnType<typeof vi.fn>; sessionHistory: ReturnType<typeof vi.fn> } {
  const closeSession = vi.fn().mockResolvedValue(undefined)
  const sessionHistory = vi.fn().mockResolvedValue([])
  vi.stubGlobal('window', { piwright: { closeSession, sessionHistory } })
  return { closeSession, sessionHistory }
}

function setGrace(minutes: number): void {
  useSessionsStore.setState({ settings: { notifications: { backgroundGraceMinutes: minutes } } as unknown as Settings })
}

describe('background watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    clearBackgroundWatchdogs()
    useSessionsStore.setState({ active: [], settings: null, activeHostId: null })
  })

  afterEach(() => {
    clearBackgroundWatchdogs()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('завершённая фоновая сессия закрывается после грейса и уходит в историю', async () => {
    const { closeSession, sessionHistory } = stubPiwright()
    seedRow({})
    rearmBackgroundWatchdogs()
    expect(closeSession).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10 * 60_000 - 1)
    expect(closeSession).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(closeSession).toHaveBeenCalledWith('h1', true)
    expect(useSessionsStore.getState().active).toHaveLength(0)
    expect(sessionHistory).toHaveBeenCalledWith(project)
  })

  it('attach (снятие фона) снимает таймер', async () => {
    const { closeSession } = stubPiwright()
    seedRow({})
    rearmBackgroundWatchdogs()
    useSessionsStore.getState().setBackground('h1', false)
    rearmBackgroundWatchdogs()
    await vi.advanceTimersByTimeAsync(30 * 60_000)
    expect(closeSession).not.toHaveBeenCalled()
  })

  it('новый ход снимает таймер, после его конца заводится заново', async () => {
    const { closeSession } = stubPiwright()
    seedRow({})
    rearmBackgroundWatchdogs()
    useSessionsStore.getState().applyStatus(status({ state: 'streaming', dot: 'busy' }))
    rearmBackgroundWatchdogs()
    await vi.advanceTimersByTimeAsync(30 * 60_000)
    expect(closeSession).not.toHaveBeenCalled()
    useSessionsStore.getState().applyStatus(status({ state: 'ready', dot: 'idle' }))
    rearmBackgroundWatchdogs()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(closeSession).toHaveBeenCalledWith('h1', true)
  })

  it('диалог (confirm) держит строку, после ответа — отсчёт', async () => {
    const { closeSession } = stubPiwright()
    seedRow({ dot: 'confirm', state: 'ready' })
    rearmBackgroundWatchdogs()
    await vi.advanceTimersByTimeAsync(30 * 60_000)
    expect(closeSession).not.toHaveBeenCalled()
    useSessionsStore.getState().applyStatus(status({ state: 'ready', dot: 'idle' }))
    rearmBackgroundWatchdogs()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(closeSession).toHaveBeenCalledWith('h1', true)
  })

  it('ошибка хода (dot error) тоже уходит после грейса', async () => {
    const { closeSession } = stubPiwright()
    seedRow({ dot: 'error', state: 'error' })
    rearmBackgroundWatchdogs()
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(closeSession).toHaveBeenCalledWith('h1', true)
  })

  it('повторный пересчёт не перезапускает отсчёт', async () => {
    const { closeSession } = stubPiwright()
    seedRow({})
    rearmBackgroundWatchdogs()
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    useSessionsStore.getState().applyStatus(status({}))
    rearmBackgroundWatchdogs()
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(closeSession).toHaveBeenCalledWith('h1', true)
  })

  it('грейс берётся из настроек', async () => {
    const { closeSession } = stubPiwright()
    setGrace(2)
    seedRow({})
    rearmBackgroundWatchdogs()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(closeSession).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(closeSession).toHaveBeenCalledWith('h1', true)
  })

  it('грейс 0 — закрытие сразу', async () => {
    const { closeSession } = stubPiwright()
    setGrace(0)
    seedRow({})
    rearmBackgroundWatchdogs()
    await vi.advanceTimersByTimeAsync(0)
    expect(closeSession).toHaveBeenCalledWith('h1', true)
  })

  it('обычная (не фоновая) idle-строка не трогается', async () => {
    const { closeSession } = stubPiwright()
    seedRow({ background: false })
    rearmBackgroundWatchdogs()
    await vi.advanceTimersByTimeAsync(30 * 60_000)
    expect(closeSession).not.toHaveBeenCalled()
  })

  it('строка, исчезнувшая до выстрела, не закрывается повторно', async () => {
    const { closeSession } = stubPiwright()
    seedRow({})
    rearmBackgroundWatchdogs()
    useSessionsStore.setState({ active: [] })
    rearmBackgroundWatchdogs()
    await vi.advanceTimersByTimeAsync(30 * 60_000)
    expect(closeSession).not.toHaveBeenCalled()
  })
})
