/** Раздача событий сессий в Telegram: turn_end / dialog_open (confirm → permission) / ошибки / конец петли.
 *  Гейт: чекбоксы события в настройках × telegram-флаг сессии × телефон не на переднем плане. */
import { basename } from 'node:path'
import type { LoopStopReason } from '../../shared/agent-events'
import type { PiEventMessage } from '../../shared/ipc-contracts'
import type { RemoteNotifyKind } from './telegram'
import { LOOP_END_REASON_TEXT, sendTelegramNotification } from './telegram'
import type { TelegramTokenStore } from './token-store'
import type { PiHost } from '../pi/pi-host'
import type { RemoteBridge } from '../remote/bridge'

export class NotificationHub {
  constructor(
    private readonly getSettings: () => import('../../shared/ipc-contracts').Settings,
    private readonly tokenStore: TelegramTokenStore,
    private readonly piHost: PiHost,
    private readonly bridge: () => RemoteBridge | null
  ) {}

  onEvent(message: PiEventMessage): void {
    const event = message.event
    let kind: RemoteNotifyKind | null = null
    if (event.type === 'turn_end') {
      // Check-ход петли — служебный, без уведомления; ход с ошибкой — уведомление об ошибке.
      if (event.check === true) return
      if (event.error != null) {
        this.send(message, 'error', event.error)
        return
      }
      kind = 'turnEnd'
    }
    else if (event.type === 'dialog_open') kind = event.dialog.kind === 'confirm' ? 'permission' : 'question'
    else if (event.type === 'notify' && event.isError) kind = 'error'
    if (kind === null) return

    this.send(message, kind)
  }

  private send(message: PiEventMessage, kind: RemoteNotifyKind, detail?: string): void {
    const settings = this.getSettings()
    if (!settings.notifications.telegram.events[kind]) return
    const host = this.piHost.get(message.hostId)
    if (host === null || host === undefined || !host.telegramEnabled) return
    const bridge = this.bridge()
    if (bridge !== null && bridge.isPhoneVisible()) return
    const token = this.tokenStore.read()
    if (token === null) return
    const status = host.lastStatus()
    if (status === null || status === undefined) return
    sendTelegramNotification(settings.notifications.telegram.chatId, token, basename(status.project.dir) || status.project.dir, status.title, kind, detail)
  }

  /** Петля завершена (loop_state с reason): уведомление с причиной, если чекбокс loopEnd включён. */
  onLoopStopped(hostId: string, reason: LoopStopReason): void {
    const settings = this.getSettings()
    if (!settings.notifications.telegram.events.loopEnd) return
    const host = this.piHost.get(hostId)
    if (host === null || host === undefined || !host.telegramEnabled) return
    const bridge = this.bridge()
    if (bridge !== null && bridge.isPhoneVisible()) return
    const token = this.tokenStore.read()
    if (token === null) return
    const status = host.lastStatus()
    if (status === null || status === undefined) return
    sendTelegramNotification(
      settings.notifications.telegram.chatId,
      token,
      basename(status.project.dir) || status.project.dir,
      status.title,
      'loopEnd',
      LOOP_END_REASON_TEXT[reason]
    )
  }
}
