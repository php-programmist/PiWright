/** Типизированный IPC-контракт renderer ↔ main. Единственная точка — preload (`window.piwright`). */
import type { DialogAnswer, ExtensionDialog, UiEvent } from './agent-events'
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
  /** Каталог моделей и thinking — из хендшейка; кнопки в шапке чата. */
  models: PiModelInfo[]
  thinkingLevels: string[]
  thinkingLevel: string | null
}

/** Транслированное событие (`UiEvent`) — renderer видит только их, не сырые кадры pi. */
export type PiEventMessage = UiEvent

export interface PromptResult {
  ok: boolean
  error: string | null
}

export interface DialogResult {
  ok: boolean
  error: string | null
}

/** Диалог, ждущий ответа renderer'а (реплей при переподключении — те же объекты). */
export interface PendingDialog {
  id: string
  dialog: ExtensionDialog
}

export interface PiwrightApi {
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  prompt(text: string): Promise<PromptResult>
  abort(): Promise<PromptResult>
  setModel(key: string): Promise<PromptResult>
  setThinkingLevel(level: string): Promise<PromptResult>
  respondDialog(id: string, answer: DialogAnswer): Promise<DialogResult>
  getPendingDialogs(): Promise<PendingDialog[]>
  onPiEvent(cb: (event: PiEventMessage) => void): () => void
  onPiStatus(cb: (status: PiStatus) => void): () => void
}

export const SETTINGS_GET_CHANNEL = 'settings:get'
export const SETTINGS_SET_CHANNEL = 'settings:set'
export const SESSION_PROMPT_CHANNEL = 'session:prompt'
export const SESSION_ABORT_CHANNEL = 'session:abort'
export const SESSION_SET_MODEL_CHANNEL = 'session:set-model'
export const SESSION_SET_THINKING_CHANNEL = 'session:set-thinking'
export const SESSION_RESPOND_DIALOG_CHANNEL = 'session:respond-dialog'
export const SESSION_PENDING_DIALOGS_CHANNEL = 'session:pending-dialogs'
export const PI_EVENT_CHANNEL = 'pi:event'
export const PI_STATUS_CHANNEL = 'pi:status'

/** Строка статуса для UI: модель + бэкенд. */
export function describeModel(model: PiModelInfo | null): string | null {
  return model ? `${model.provider}/${model.id}` : null
}
