/** models.json как редактируемая структура: известные поля — формами, остальное — extraText
 *  (JSON на модель). Чистые функции — без side-effects; числа в инпутах держим строками. */
export interface ModelEdit {
  id: string
  name: string
  contextWindow: string
  maxTokens: string
  input: string[]
  reasoning: boolean
  /** Пары уровень → значение API; пустое значение = null (уровень отключён). */
  thinkingLevelMap: Array<{ level: string; value: string }>
  /** JSON-текст прочих полей модели (samplingParams и т.п.); пустая строка = нет. */
  extraText: string
}

export interface ProviderEdit {
  name: string
  baseUrl: string
  api: string
  apiKey: string
  models: ModelEdit[]
  /** Прочие поля провайдера — сохраняются как есть (без редактора). */
  extra: Record<string, unknown>
}

export interface ParsedModelsDoc {
  providers: ProviderEdit[]
  /** Посторонние верхнеуровневые ключи файла — сохраняются при записи. */
  rest: Record<string, unknown>
}

const KNOWN_MODEL_KEYS = new Set(['id', 'name', 'contextWindow', 'maxTokens', 'input', 'reasoning', 'thinkingLevelMap'])
const KNOWN_PROVIDER_KEYS = new Set(['baseUrl', 'api', 'apiKey', 'models'])

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNumberString(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function parseExtra(record: Record<string, unknown>, known: Set<string>): Record<string, unknown> {
  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (!known.has(key)) extra[key] = value
  }
  return extra
}

function parseThinkingLevelMap(value: unknown): Array<{ level: string; value: string }> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.entries(value as Record<string, unknown>).map(([level, raw]) => ({
    level,
    value: typeof raw === 'string' ? raw : raw === null ? '' : String(raw)
  }))
}

function parseModel(record: Record<string, unknown>): ModelEdit {
  const extra = parseExtra(record, KNOWN_MODEL_KEYS)
  return {
    id: asString(record['id']),
    name: asString(record['name']),
    contextWindow: asNumberString(record['contextWindow']),
    maxTokens: asNumberString(record['maxTokens']),
    input: asStringList(record['input']),
    reasoning: record['reasoning'] === true,
    thinkingLevelMap: parseThinkingLevelMap(record['thinkingLevelMap']),
    extraText: Object.keys(extra).length > 0 ? JSON.stringify(extra, null, 2) : ''
  }
}

function parseProvider(name: string, record: Record<string, unknown>): ProviderEdit {
  const modelsRaw = record['models']
  return {
    name,
    baseUrl: asString(record['baseUrl']),
    api: asString(record['api']),
    apiKey: asString(record['apiKey']),
    models: Array.isArray(modelsRaw)
      ? modelsRaw.filter((m): m is Record<string, unknown> => m !== null && typeof m === 'object' && !Array.isArray(m)).map(parseModel)
      : [],
    extra: parseExtra(record, KNOWN_PROVIDER_KEYS)
  }
}

/** raw JSON → редактируемая структура; битые ветки пропускаются. */
export function parseModelsDoc(raw: unknown): ParsedModelsDoc {
  const rest: Record<string, unknown> =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {}
  const providersRaw = rest['providers']
  const providers: ProviderEdit[] = []
  if (providersRaw !== null && typeof providersRaw === 'object' && !Array.isArray(providersRaw)) {
    for (const [name, value] of Object.entries(providersRaw as Record<string, unknown>)) {
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        providers.push(parseProvider(name, value as Record<string, unknown>))
      }
    }
  }
  delete rest['providers']
  return { providers, rest }
}

function serializeModel(model: ModelEdit): Record<string, unknown> {
  const out: Record<string, unknown> = { id: model.id }
  if (model.name.trim().length > 0) out['name'] = model.name
  const contextWindow = Number(model.contextWindow.trim())
  if (model.contextWindow.trim().length > 0 && Number.isFinite(contextWindow)) out['contextWindow'] = contextWindow
  const maxTokens = Number(model.maxTokens.trim())
  if (model.maxTokens.trim().length > 0 && Number.isFinite(maxTokens)) out['maxTokens'] = maxTokens
  if (model.input.length > 0) out['input'] = [...model.input]
  if (model.reasoning) out['reasoning'] = true
  if (model.thinkingLevelMap.length > 0) {
    const map: Record<string, string | null> = {}
    for (const { level, value } of model.thinkingLevelMap) {
      if (level.trim().length === 0) continue
      map[level] = value.trim().length > 0 ? value : null
    }
    out['thinkingLevelMap'] = map
  }
  if (model.extraText.trim().length > 0) {
    const extra: unknown = JSON.parse(model.extraText)
    if (extra !== null && typeof extra === 'object' && !Array.isArray(extra)) {
      Object.assign(out, extra)
    }
  }
  return out
}

function serializeProvider(provider: ProviderEdit): Record<string, unknown> {
  const out: Record<string, unknown> = {
    baseUrl: provider.baseUrl,
    api: provider.api,
    apiKey: provider.apiKey,
    models: provider.models.map(serializeModel)
  }
  return { ...out, ...provider.extra }
}

/** Редактируемая структура → raw JSON; бросает Error на битом extraText. */
export function serializeModelsDoc(parsed: ParsedModelsDoc): Record<string, unknown> {
  const providers: Record<string, unknown> = {}
  for (const provider of parsed.providers) {
    providers[provider.name] = serializeProvider(provider)
  }
  return { ...parsed.rest, providers }
}

/** Копия провайдера под новым именем (для переноса между бэкендами). */
export function cloneProvider(provider: ProviderEdit, name: string): ProviderEdit {
  return {
    ...provider,
    name,
    models: provider.models.map((m) => ({ ...m, input: [...m.input], thinkingLevelMap: m.thinkingLevelMap.map((e) => ({ ...e })) }))
  }
}

/** Копия модели (для переноса между бэкендами). */
export function cloneModel(model: ModelEdit): ModelEdit {
  return { ...model, input: [...model.input], thinkingLevelMap: model.thinkingLevelMap.map((e) => ({ ...e })) }
}
