/** Уведомления через бота Telegram: HTTPS POST в api.telegram.org. Порт `TelegramNotifier.kt`
 *  (raw fetch, без библиотек; сообщение об ошибке не содержит токен — он в URL). */
import type { LoopStopReason } from '../../shared/agent-events'

export type RemoteNotifyKind = 'turnEnd' | 'permission' | 'question' | 'error' | 'loopEnd'

export const NOTIFY_KIND_TEXT: Record<RemoteNotifyKind, string> = {
  turnEnd: 'ход завершён',
  permission: 'просит разрешение на команду',
  question: 'нужен ответ',
  error: 'ошибка',
  loopEnd: 'петля завершена'
}

/** Причина завершения петли — human-readable текст для телеграм-уведомления. */
export const LOOP_END_REASON_TEXT: Record<LoopStopReason, string> = {
  agent: 'ход без вызовов инструментов',
  exit: 'условие выхода выполнено',
  user: 'остановлена пользователем',
  max: 'достигнут лимит итераций',
  'short-circuit': '3 итерации подряд быстрее 10 секунд',
  error: 'не удалось запустить следующую итерацию'
}

export function telegramMessage(project: string, title: string, kind: RemoteNotifyKind, detail?: string): string {
  const suffix = detail !== undefined && detail.length > 0 ? ` (${detail})` : ''
  return `${project} · ${title}: ${NOTIFY_KIND_TEXT[kind]}${suffix}`
}

const REQUEST_TIMEOUT_MS = 10000

/** База API: переопределяется env для смоуков (захват запросов локальным сервером). */
const TELEGRAM_API_BASE = process.env['PIWRIGHT_TELEGRAM_API']?.trim() || 'https://api.telegram.org'

async function send(chatId: string, token: string, text: string): Promise<string | null> {
  let url: URL
  try {
    url = new URL(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`)
  } catch {
    return 'invalid request'
  }
  const body = JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true })
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    })
    const json = (await response.json().catch(() => null)) as { ok?: boolean; description?: string } | null
    if (response.status === 200 && json?.ok === true) return null
    return json?.description ?? `HTTP ${response.status}`
  } catch (err) {
    return err instanceof Error ? err.name : 'network error'
  }
}

/** Тестовое сообщение из настроек: текст ошибки или null при успехе. */
export function sendTestTelegram(chatId: string, token: string): Promise<string | null> {
  const id = chatId.trim()
  const key = token.trim()
  if (id.length === 0) return Promise.resolve('chat_id is empty')
  if (key.length === 0) return Promise.resolve('bot token is empty')
  return send(id, key, telegramMessage('PiWright', 'settings', 'turnEnd'))
}

/** Уведомление о событии сессии; ошибки глотаются (fire-and-forget). */
export function sendTelegramNotification(chatId: string, token: string, project: string, title: string, kind: RemoteNotifyKind, detail?: string): void {
  if (chatId.trim().length === 0 || token.length === 0) return
  void send(chatId.trim(), token, telegramMessage(project, title, kind, detail))
}
