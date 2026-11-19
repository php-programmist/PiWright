/** Типизированный IPC-контракт renderer ↔ main. Единственная точка — preload (`window.piwright`). */
import type { PiModelInfo } from './protocol-types'

export type BackendMode = 'native' | 'wsl' | 'auto'

export interface Settings {
  backend: BackendMode
  wslDistro: string
  piPath: string
  projectDir: string
}

export type PiStatusState = 'idle' | 'starting' | 'ready' | 'streaming' | 'disconnected' | 'error'

export interface PiStatus {
  state: PiStatusState
  backend: string | null
  model: string | null
  sessionId: string | null
  sessionFile: string | null
  error: string | null
}

/** Событие pi, проброшенное в renderer: `{type, payload}` без `id`. */
export interface PiEventMessage {
  type: string
  payload: Record<string, unknown>
}

export interface PromptResult {
  ok: boolean
  error: string | null
}

export interface PiwrightApi {
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  prompt(text: string): Promise<PromptResult>
  onPiEvent(cb: (event: PiEventMessage) => void): () => void
  onPiStatus(cb: (status: PiStatus) => void): () => void
}

export const SETTINGS_GET_CHANNEL = 'settings:get'
export const SETTINGS_SET_CHANNEL = 'settings:set'
export const SESSION_PROMPT_CHANNEL = 'session:prompt'
export const PI_EVENT_CHANNEL = 'pi:event'
export const PI_STATUS_CHANNEL = 'pi:status'

/** Строка статуса для UI: модель + бэкенд. */
export function describeModel(model: PiModelInfo | null): string | null {
  return model ? `${model.provider}/${model.id}` : null
}
