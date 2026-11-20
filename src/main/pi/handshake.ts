/** Хендшейк живой сессии: `get_state` → `get_available_models` → `get_commands` →
 *  `get_session_stats` → `get_available_thinking_levels` → `set_thinking_level` → `set_session_name`.
 *  Порт `PiSession.requestState` + `requestThinkingState`. */
import type { PiConnection } from './connection'
import type {
  PiHandshakeResult,
  PiJsonObject,
  PiModelInfo,
  PiResponse,
  PiSlashCommand
} from '../../shared/protocol-types'
import type { SessionTokens } from '../../shared/agent-events'

const EXTENDED_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

/** Копия правила pi (`getSupportedThinkingLevels`): без reasoning остаётся только «off»;
 *  `null` в `thinkingLevelMap` уровень запрещает, «xhigh»/«max» нужны только с явным маппингом. */
export function supportedThinkingLevels(reasoning: boolean, levelMap: Record<string, string | null>): string[] {
  if (!reasoning) return ['off']
  return EXTENDED_THINKING_LEVELS.filter((level) => {
    if (!(level in levelMap)) return level !== 'xhigh' && level !== 'max'
    return levelMap[level] !== null
  })
}

export function decodeModel(obj: PiJsonObject): PiModelInfo | null {
  const provider = obj['provider']
  const id = obj['id']
  if (typeof provider !== 'string' || typeof id !== 'string') return null
  const levelMapRaw = obj['thinkingLevelMap']
  const levelMap: Record<string, string | null> = {}
  if (levelMapRaw !== null && typeof levelMapRaw === 'object' && !Array.isArray(levelMapRaw)) {
    for (const [key, value] of Object.entries(levelMapRaw as Record<string, unknown>)) {
      levelMap[key] = typeof value === 'string' ? value : null
    }
  }
  const input = Array.isArray(obj['input']) ? obj['input'] : []
  const contextWindow = obj['contextWindow']
  return {
    provider,
    id,
    name: typeof obj['name'] === 'string' ? obj['name'] : id,
    contextWindow: typeof contextWindow === 'number' ? contextWindow : 0,
    imageInput: input.includes('image'),
    thinkingLevels: supportedThinkingLevels(obj['reasoning'] === true, levelMap)
  }
}

function dataObject(response: PiResponse): PiJsonObject {
  return response.data !== null && typeof response.data === 'object' && !Array.isArray(response.data)
    ? (response.data as PiJsonObject)
    : {}
}

/** `tokens` из `get_session_stats`; null — ответ не содержит статистику. */
export function decodeSessionTokens(response: PiResponse): SessionTokens | null {
  const stats = dataObject(response)
  const raw = stats['tokens']
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const t = raw as PiJsonObject
  const num = (key: string): number => (typeof t[key] === 'number' && Number.isFinite(t[key]) ? (t[key] as number) : 0)
  return { input: num('input'), output: num('output'), cacheRead: num('cacheRead'), cacheWrite: num('cacheWrite') }
}

function decodeCommands(data: PiJsonObject): PiSlashCommand[] {
  const raw = data['commands']
  if (!Array.isArray(raw)) return []
  const commands: PiSlashCommand[] = []
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
    const c = entry as PiJsonObject
    if (typeof c['name'] !== 'string') continue
    commands.push({
      name: c['name'],
      description: typeof c['description'] === 'string' ? c['description'] : null,
      source: typeof c['source'] === 'string' ? c['source'] : null
    })
  }
  return commands
}

export interface HandshakeOptions {
  /** Имя сессии, отправляется в конце хендшейка (`set_session_name`). */
  sessionName?: string | null
  /** Желаемый уровень thinking; применяется, только если модель его поддерживает. */
  desiredThinkingLevel?: string | null
}

export async function runHandshake(conn: PiConnection, opts: HandshakeOptions = {}): Promise<PiHandshakeResult> {
  const state = dataObject(await conn.request('get_state'))
  const sessionId = typeof state['sessionId'] === 'string' ? state['sessionId'] : ''
  const sessionFile = typeof state['sessionFile'] === 'string' ? state['sessionFile'] : null
  const modelRaw = state['model']
  const model =
    modelRaw !== null && typeof modelRaw === 'object' && !Array.isArray(modelRaw)
      ? decodeModel(modelRaw as PiJsonObject)
      : null

  const modelsResponse = await conn.request('get_available_models')
  const modelsRaw = dataObject(modelsResponse)['models']
  const models: PiModelInfo[] = []
  if (Array.isArray(modelsRaw)) {
    for (const entry of modelsRaw) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
      const decoded = decodeModel(entry as PiJsonObject)
      if (decoded !== null) models.push(decoded)
    }
  }

  const commands = decodeCommands(dataObject(await conn.request('get_commands')))

  const sessionTokens = decodeSessionTokens(await conn.request('get_session_stats'))

  const levelsRaw = dataObject(await conn.request('get_available_thinking_levels'))['levels']
  const levels = Array.isArray(levelsRaw) ? levelsRaw.filter((l): l is string => typeof l === 'string') : []
  const currentState = dataObject(await conn.request('get_state'))
  const currentLevel = typeof currentState['thinkingLevel'] === 'string' ? currentState['thinkingLevel'] : null
  const desired = opts.desiredThinkingLevel ?? null
  let thinkingLevel = currentLevel
  if (desired !== null && desired.length > 0 && levels.includes(desired) && desired !== currentLevel) {
    const response = await conn.request('set_thinking_level', { level: desired })
    if (response.success) thinkingLevel = desired
  }

  if (opts.sessionName != null && opts.sessionName.length > 0) {
    await conn.request('set_session_name', { name: opts.sessionName })
  }

  return {
    sessionId,
    sessionFile,
    model,
    models,
    commands,
    thinkingLevels: levels,
    thinkingLevel,
    autoCompactionEnabled: state['autoCompactionEnabled'] === true,
    sessionTokens
  }
}
