/** Чистые функции протокола «телефон ↔ десктоп». Порт `core/remote/RemoteProtocol.kt`
 *  (Gson → JSON-объекты PiWright, ModelInfo → PiModelInfo, todo — shared/todo). */
import { randomUUID } from 'node:crypto'
import type { LoopInfo } from '../../shared/agent-events'
import type { PiJsonObject } from '../../shared/protocol-types'
import type { PiModelInfo } from '../../shared/protocol-types'
import { PLAN_WIDGET_KEY, TODO_WIDGET_KEY, parseTodoLines } from '../../shared/todo'
import type { TodoItem } from '../../shared/todo'
import type { RemoteNotifyKind } from '../notifications/telegram'
import { NOTIFY_KIND_TEXT } from '../notifications/telegram'

/** Префикс id запросов, пришедших с телефона: по нему ответ маршрутизируется отправителю. */
export const REMOTE_ID_PREFIX = 'web-'

export function remoteRequestId(socketSeq: number, clientId: string | null): string {
  return `${REMOTE_ID_PREFIX}${socketSeq}-${clientId ?? 'auto'}`
}

/** Исходный id клиента, если id принадлежит сокету seq; иначе null (ответ чужой). */
export function stripRemoteRequestId(socketSeq: number, id: string): string | null {
  const head = `${REMOTE_ID_PREFIX}${socketSeq}-`
  return id.startsWith(head) ? id.slice(head.length) : null
}

export function parseFrame(line: string): PiJsonObject | null {
  try {
    const parsed: unknown = JSON.parse(line)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as PiJsonObject
  } catch {
    return null
  }
}

export function frameString(frame: PiJsonObject, field: string): string | null {
  const value = frame[field]
  return typeof value === 'string' ? value : null
}

export interface RemoteSessionInfo {
  id: string
  title: string
  project: string
  status: string
  telegram: boolean
  /** Ход завершился, а телефон его не долистал (как зелёная точка на десктопе). */
  unread: boolean
}

/** Событие, о котором десктоп сообщает в Telegram. */
export const NOTIFY_TEXT = NOTIFY_KIND_TEXT

export function telegramMessageText(project: string, title: string, kind: RemoteNotifyKind): string {
  return `${project} · ${title}: ${NOTIFY_TEXT[kind]}`
}

export function sessionListFrame(sessions: RemoteSessionInfo[]): PiJsonObject {
  return {
    type: 'sessions',
    sessions: sessions.map((s) => ({
      id: s.id,
      title: s.title,
      project: s.project,
      status: s.status,
      telegram: s.telegram,
      unread: s.unread
    }))
  }
}

export function errorFrame(message: string): PiJsonObject {
  return { type: 'error', message }
}

export interface CreateSessionRequest {
  name: string
  model: string | null
  thinking: string | null
  project: string | null
}

export const MAX_SESSION_NAME_CHARS = 100

/** Кадр `create_session`: пустое имя → defaultName, длинное — обрезается. */
export function normalizeCreateSessionRequest(frame: PiJsonObject, defaultName: string): CreateSessionRequest {
  const str = (field: string): string | null => {
    const value = frame[field]
    return typeof value === 'string' && value.trim().length > 0 ? value : null
  }
  return {
    name: (str('name') ?? defaultName).slice(0, MAX_SESSION_NAME_CHARS),
    model: str('model'),
    thinking: str('thinking'),
    project: str('project')
  }
}

/** Новое имя из кадра `rename`: не-строка/пустота — null (ничего не меняем). */
export function normalizeSessionName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed.slice(0, MAX_SESSION_NAME_CHARS) : null
}

/** Проект новой сессии: явный выбор телефона главнее; без выбора — если кандидат один. */
export function resolveCreateProject(requested: string | null, available: string[]): string | null {
  if (requested !== null) return requested
  return available.length === 1 ? available[0] : null
}

export function sessionCreatedFrame(sessionId: string): PiJsonObject {
  return { type: 'session_created', id: sessionId }
}

export interface CatalogModel {
  key: string
  name: string
  provider: string
  thinkingLevels?: string[]
}

/** Кадр каталога для формы новой сессии: модели, уровни thinking и дефолты живой сессии. */
export function catalogFrame(
  models: CatalogModel[],
  thinkingLevels: string[],
  defaultModel: string | null,
  defaultThinking: string | null,
  requestId: string | null = null
): PiJsonObject {
  const frame: PiJsonObject = {
    type: 'catalog',
    success: true,
    models: models.map((m) => {
      const entry: PiJsonObject = { key: m.key, name: m.name, provider: m.provider }
      if (m.thinkingLevels !== undefined && m.thinkingLevels.length > 0) entry['thinkingLevels'] = m.thinkingLevels
      return entry
    }),
    thinkingLevels
  }
  if (defaultModel !== null) frame['defaultModel'] = defaultModel
  if (defaultThinking !== null) frame['defaultThinking'] = defaultThinking
  if (requestId !== null) frame['id'] = requestId
  return frame
}

/** Модели из данных ответа `get_available_models` (поле `models`). */
export function decodeCatalogModels(data: PiJsonObject | null): CatalogModel[] {
  const array = data?.['models']
  if (!Array.isArray(array)) return []
  const result: CatalogModel[] = []
  for (const item of array) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    if (typeof record['key'] !== 'string' || typeof record['name'] !== 'string' || typeof record['provider'] !== 'string') continue
    const levels = Array.isArray(record['thinkingLevels'])
      ? record['thinkingLevels'].filter((l): l is string => typeof l === 'string')
      : []
    result.push({
      key: record['key'],
      name: record['name'],
      provider: record['provider'],
      ...(levels.length > 0 ? { thinkingLevels: levels } : {})
    })
  }
  return result
}

/** Уровни thinking из данных ответа `get_available_thinking_levels` (поле `levels`). */
export function decodeCatalogThinkingLevels(data: PiJsonObject | null): string[] {
  const array = data?.['levels']
  if (!Array.isArray(array)) return []
  return array.filter((l): l is string => typeof l === 'string')
}

export function attachedFrame(sessionId: string, title: string, project: string, telegram: boolean, loops: boolean): PiJsonObject {
  return { type: 'attached', id: sessionId, title, project, telegram, loops }
}

/** Состояние петли сессии (чекбокс «Петля»): active/remaining/reason. */
export function loopStateFrame(sessionId: string, info: LoopInfo): PiJsonObject {
  return { type: 'loop_state', id: sessionId, info }
}

export function uiAnsweredFrame(id: string, by: string): PiJsonObject {
  return { type: 'ui_answered', id, by }
}

/** Модель PiWright для кадра catalog: key = provider/id. */
export function catalogModelOf(model: PiModelInfo): CatalogModel {
  return {
    key: `${model.provider}/${model.id}`,
    name: model.name,
    provider: model.provider,
    ...(model.thinkingLevels.length > 0 ? { thinkingLevels: model.thinkingLevels } : {})
  }
}

/** Адаптеры виртуальных сетей (WSL, Hyper-V, VM, docker, туннели) — телефону они не годятся. */
export function isVirtualAdapterName(name: string): boolean {
  const lower = name.toLowerCase()
  return [
    'vethernet', 'wsl', 'hyper-v', 'vmware', 'virtualbox', 'vbox', 'docker',
    'veth', 'br-', 'tap', 'tun', 'utun', 'tailscale', 'zerotier', 'bluetooth',
    'loopback', 'npcap', 'virtual'
  ].some((token) => lower.includes(token))
}

/** Домашние LAN чаще 192.168.x, корпоративные — 10.x; 172.16/12 — типичный WSL. */
export function addressRank(address: string): number {
  if (address.startsWith('192.168.')) return 0
  if (address.startsWith('10.')) return 1
  if (address.startsWith('172.')) return 2
  return 3
}

/** Лучший адрес для телефона: реальный адаптер, затем по префиксу; виртуальные — если других нет. */
export function pickLanAddress(candidates: [string, string][]): string | null {
  const real = candidates.filter(([name]) => !isVirtualAdapterName(name))
  const pool = real.length > 0 ? real : candidates
  if (pool.length === 0) return null
  return pool.reduce((best, cur) => (addressRank(cur[1]) < addressRank(best[1]) ? cur : best))[1]
}

export const MAX_PROMPT_IMAGES = 3
export const MAX_IMAGE_BASE64_CHARS = 1_500_000

export interface PromptImages {
  blocks: PiJsonObject[]
  error: string | null
}

/** Валидация `images` кадра `prompt`: массив `{data, mimeType}` → блоки `{type:'image', …}`. */
export function normalizePromptImages(value: unknown): PromptImages {
  if (value === null || value === undefined) return { blocks: [], error: null }
  if (!Array.isArray(value)) return { blocks: [], error: 'images must be an array' }
  if (value.length > MAX_PROMPT_IMAGES) return { blocks: [], error: `too many images: max ${MAX_PROMPT_IMAGES}` }
  const blocks: PiJsonObject[] = []
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      return { blocks: [], error: 'image must be an object' }
    }
    const record = item as Record<string, unknown>
    const data = typeof record['data'] === 'string' && record['data'].length > 0 ? record['data'] : null
    if (data === null) return { blocks: [], error: 'image data is missing' }
    const mimeType = typeof record['mimeType'] === 'string' && record['mimeType'].length > 0 ? record['mimeType'] : null
    if (mimeType === null) return { blocks: [], error: 'image mimeType is missing' }
    if (data.length > MAX_IMAGE_BASE64_CHARS) return { blocks: [], error: 'image is too large' }
    blocks.push({ type: 'image', data, mimeType })
  }
  return { blocks, error: null }
}

export function snapshotFrame(
  messages: unknown[] | null = null,
  state: PiJsonObject | null = null,
  stats: PiJsonObject | null = null,
  streaming = false
): PiJsonObject {
  const frame: PiJsonObject = { type: 'snapshot', streaming }
  if (messages !== null) frame['messages'] = messages
  if (state !== null) frame['state'] = state
  if (stats !== null) frame['stats'] = stats
  return frame
}

/** Задачи для телефона: виджет pi-todo главнее шагов plan-mode. */
export function remoteTodos(widgetLines: Record<string, string[]>): TodoItem[] {
  return parseTodoLines(widgetLines[TODO_WIDGET_KEY] ?? widgetLines[PLAN_WIDGET_KEY] ?? [])
}

/** Кадр списка задач; пустой список — снять панель. */
export function todosFrame(items: TodoItem[]): PiJsonObject {
  return {
    type: 'todos',
    items: items.map((item) => ({ content: item.subject, status: item.status }))
  }
}

export function newRemoteSessionId(): string {
  return randomUUID()
}
