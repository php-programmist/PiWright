import type { DaemonBgSession, DaemonStatus } from '../../../shared/ipc-contracts'
import type { SessionRow } from '../stores/sessions'

/** Строка попапа фоновых сессий: ребёнок демона без клиентов или eject-сессия приложения. */
export interface BgSessionRow extends DaemonBgSession {
  /** Живой хост этого приложения (eject-сессия): аттач — активация хоста, не openSession. */
  hostId?: string
}

/** Объединение двух источников фоновых сессий. Демон считает только детей без клиентов
 *  (clients=0); eject-сессии живут в своих хостах и прицеплены к ребёнку, поэтому их
 *  добавляем из строк панели с флагом background. Если файл сессии уже есть в списке
 *  демона (соединение с демоном переоткрылось — клиент отвалился), строка приложения
 *  уступает место демон-строке: у неё честное состояние ребёнка и рабочий аттач. */
export function mergeBackgroundSessions(daemon: DaemonStatus, active: SessionRow[]): BgSessionRow[] {
  const daemonFiles = new Set(daemon.sessions.map((s) => s.sessionFile).filter((f): f is string => f !== null))
  const ejected = active
    .filter((r) => r.background && (r.sessionFile === null || !daemonFiles.has(r.sessionFile)))
    .map((r) => ({
      sessionKey: `host:${r.hostId}`,
      sessionFile: r.sessionFile,
      mode: r.project.kind,
      projectDir: r.project.dir,
      title: r.title,
      streaming: r.dot !== 'idle' && r.dot !== 'error',
      hostId: r.hostId
    }))
  return [...daemon.sessions, ...ejected]
}
