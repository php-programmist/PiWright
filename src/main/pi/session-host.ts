/** Реестр одной pi-сессии фазы 1: ленивый старт, хендшейк, стрим событий, рестарт после падения
 *  с `--session <путь>`. Порт жизненного цикла `PiSession` (без форков/очередей — фаза 2). */
import type {
  PiEventMessage,
  PiStatus,
  PromptResult,
  Settings
} from '../../shared/ipc-contracts'
import type { PiBackend } from './backends/types'
import { PiConnection } from './connection'
import { createPiBackend } from './backends/factory'
import type { CreateBackendResult } from './backends/factory'
import { runHandshake } from './handshake'
import { piArgs } from './pi-args'

export interface SessionHostListener {
  onStatus(status: PiStatus): void
  onEvent(event: PiEventMessage): void
}

export class SessionHost {
  private static readonly instances = new Set<SessionHost>()

  static disposeAll(): void {
    for (const instance of SessionHost.instances) instance.dispose()
  }

  private conn: PiConnection | null = null
  private backend: PiBackend | null = null
  private sessionFile: string | null = null
  private startPromise: Promise<void> | null = null

  constructor(
    private readonly getSettings: () => Settings,
    private readonly listener: SessionHostListener,
    private readonly createBackend: (settings: Settings) => Promise<CreateBackendResult> = createPiBackend
  ) {
    SessionHost.instances.add(this)
  }

  private status(state: PiStatus['state'], error: string | null = null): void {
    this.listener.onStatus({
      state,
      backend: this.backend?.displayName ?? null,
      model: null,
      sessionId: null,
      sessionFile: this.sessionFile,
      error
    })
  }

  private statusWith(state: PiStatus['state'], error: string | null, model: string | null, sessionId: string | null): void {
    this.listener.onStatus({
      state,
      backend: this.backend?.displayName ?? null,
      model,
      sessionId,
      sessionFile: this.sessionFile,
      error
    })
  }

  /** Ленивый старт: бэкенд из настроек → спавн → хендшейк. Упавший процесс поднимается
   *  заново с `--session <файл>` на следующем prompt. */
  private ensureStarted(): Promise<void> {
    if (this.conn !== null && this.conn.running) return Promise.resolve()
    if (this.startPromise !== null) return this.startPromise
    this.startPromise = this.start().finally(() => {
      this.startPromise = null
    })
    return this.startPromise
  }

  private async start(): Promise<void> {
    const settings = this.getSettings()
    const projectDir = settings.projectDir.trim()
    if (projectDir.length === 0) {
      throw new Error('Project directory is not set. Open settings and pick a directory.')
    }
    this.status('starting')
    const created = await this.createBackend(settings)
    if (created.backend === null) {
      throw new Error(created.error)
    }
    this.backend = created.backend
    const conn = new PiConnection(created.backend.spawner, {
      onEvent: (type, payload) => this.handleEvent(type, payload),
      onExtensionUiRequest: (id, method, payload) => {
        this.listener.onEvent({ type: 'extension_ui_request', payload: { id, method, ...payload } })
      },
      onDisconnected: (cause, exitCode, stderrTail) => {
        this.conn = null
        const message = cause !== null || exitCode !== null
          ? `pi exited (code ${exitCode ?? '?'}). stderr: ${stderrTail || '—'}`
          : 'pi exited'
        this.status('disconnected', message)
      }
    })
    try {
      await conn.start({ cwd: projectDir, args: piArgs(this.sessionFile) })
      const handshake = await runHandshake(conn)
      this.sessionFile = handshake.sessionFile
      this.conn = conn
      this.statusWith('ready', null, handshake.model ? `${handshake.model.provider}/${handshake.model.id}` : null, handshake.sessionId)
    } catch (err) {
      conn.close()
      throw err instanceof Error ? err : new Error(String(err))
    }
  }

  private handleEvent(type: string, payload: Record<string, unknown>): void {
    if (type === 'agent_start') {
      this.statusWith('streaming', null, null, null)
    } else if (type === 'agent_settled' || type === 'agent_end') {
      this.statusWith('ready', null, null, null)
    }
    this.listener.onEvent({ type, payload })
  }

  private async sendPrompt(text: string): Promise<PromptResult> {
    const conn = this.conn
    if (conn === null || !conn.running) return { ok: false, error: 'pi connection is not running' }
    const response = await conn.request('prompt', { message: text })
    if (!response.success) {
      const error = `${response.command} failed: ${response.error ?? 'no details'}`
      this.status('error', error)
      return { ok: false, error }
    }
    return { ok: true, error: null }
  }

  async prompt(text: string): Promise<PromptResult> {
    try {
      await this.ensureStarted()
      return await this.sendPrompt(text)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.conn = null
      this.status('error', message)
      return { ok: false, error: message }
    }
  }

  dispose(): void {
    SessionHost.instances.delete(this)
    this.conn?.close()
    this.conn = null
  }
}
