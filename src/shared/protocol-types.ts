/** Типы протокола `pi --mode rpc` (JSONL по stdout/stdin). Порт `core/rpc/PiRpc.kt`. */

/** Ответ pi на команду: `{type:"response", command, success, data?, error?, id?}`. `error` — строка. */
export interface PiResponse {
  id: string | null
  command: string
  success: boolean
  data: unknown
  error: string | null
}

/** Одна строка из stdout `pi --mode rpc`. */
export type PiInbound =
  | { kind: 'response'; response: PiResponse }
  | { kind: 'extensionUiRequest'; id: string; method: string; payload: Record<string, unknown> }
  | { kind: 'event'; type: string; payload: Record<string, unknown> }

export type PiJsonObject = Record<string, unknown>

/** Модель из `get_state.model` / `get_available_models.models`. Порт `decodeModel`. */
export interface PiModelInfo {
  provider: string
  id: string
  name: string
  contextWindow: number
  imageInput: boolean
  thinkingLevels: string[]
}

/** Слэш-команда из `get_commands`. */
export interface PiSlashCommand {
  name: string
  description: string | null
  source: string | null
}

/** Итог хендшейка (`get_state` → модели → команды → статистика → thinking → имя). */
export interface PiHandshakeResult {
  sessionId: string
  sessionFile: string | null
  model: PiModelInfo | null
  models: PiModelInfo[]
  commands: PiSlashCommand[]
  thinkingLevels: string[]
  thinkingLevel: string | null
  /** Имя сессии из `get_state` (`sessionName`) — persisted-имя при возобновлении, null у новой. */
  sessionName: string | null
  autoCompactionEnabled: boolean
  /** Суммарные токены сессии из `get_session_stats` (input/output/cacheRead/cacheWrite). */
  sessionTokens: { input: number; output: number; cacheRead: number; cacheWrite: number } | null
}
