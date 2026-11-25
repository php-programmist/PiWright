/** Renderer crash recovery: "sandbox disabled" marker in userData (survives restart,
 *  read before app.ready), crash log, and dialog texts.
 *  Sync-only fs and no electron imports: the module is used before ready and in tests. */
import { appendFileSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UiLanguage } from '../shared/ipc-contracts'

const OVERRIDE_FILE = 'sandbox-override.json'
const CRASH_LOG_FILE = 'crash-log.txt'
const CRASH_LOG_MAX_BYTES = 512 * 1024

/** render-process-gone reasons that reload / no-sandbox fallback can fix.
 *  clean-exit/killed are normal termination or an external kill, abnormal-exit is too noisy. */
const RECOVERABLE_REASONS = new Set(['crashed', 'oom', 'launch-failed', 'integrity-failure'])

export function isRecoverableCrash(reason: string): boolean {
  return RECOVERABLE_REASONS.has(reason)
}

export interface SandboxOverride {
  noSandbox: boolean
  reason: string
  since: string
}

export function readSandboxOverride(userDataDir: string): SandboxOverride | null {
  try {
    const raw: unknown = JSON.parse(readFileSync(join(userDataDir, OVERRIDE_FILE), 'utf8'))
    if (raw === null || typeof raw !== 'object' || (raw as Record<string, unknown>).noSandbox !== true) return null
    const rec = raw as Record<string, unknown>
    return {
      noSandbox: true,
      reason: typeof rec.reason === 'string' ? rec.reason : '',
      since: typeof rec.since === 'string' ? rec.since : ''
    }
  } catch {
    return null
  }
}

export function writeSandboxOverride(userDataDir: string, reason: string): void {
  const payload: SandboxOverride = { noSandbox: true, reason, since: new Date().toISOString() }
  writeFileSync(join(userDataDir, OVERRIDE_FILE), JSON.stringify(payload, null, 2), 'utf8')
}

export function clearSandboxOverride(userDataDir: string): void {
  try {
    unlinkSync(join(userDataDir, OVERRIDE_FILE))
  } catch {
    /* absent — already clean */
  }
}

export function appendCrashLog(userDataDir: string, line: string): void {
  try {
    const path = join(userDataDir, CRASH_LOG_FILE)
    try {
      if (statSync(path).size > CRASH_LOG_MAX_BYTES) unlinkSync(path)
    } catch {
      /* no file yet */
    }
    appendFileSync(path, line + '\n', 'utf8')
  } catch {
    /* diagnostics must never break the crash handler */
  }
}

export interface CrashDialogPlan {
  title: string
  message: string
  detail: string
  buttons: string[]
  /** Index of the "restart without sandbox" button, -1 when absent. */
  restartNoSandboxIndex: number
}

export function crashDialogPlan(lang: UiLanguage, sandboxDisabled: boolean, reason: string, exitCode: number): CrashDialogPlan {
  const cause = lang === 'ru' ? `Причина: ${reason} (код ${exitCode}).` : `Reason: ${reason} (exit code ${exitCode}).`
  if (sandboxDisabled) {
    return {
      title: lang === 'ru' ? 'Сбой интерфейса PiWright' : 'PiWright UI crash',
      message: lang === 'ru' ? 'Интерфейс аварийно завершился.' : 'The UI process crashed.',
      detail:
        lang === 'ru'
          ? `${cause} Песочница уже отключена, но падения продолжаются — дело, скорее всего, не в ней. Проверьте антивирус (добавьте PiWright в исключения) и переустановите приложение.`
          : `${cause} The sandbox is already disabled, yet crashes continue — the cause is likely elsewhere. Check your antivirus (add PiWright to exclusions) and try reinstalling the app.`,
      buttons: lang === 'ru' ? ['Перезагрузить', 'Закрыть'] : ['Reload', 'Quit'],
      restartNoSandboxIndex: -1
    }
  }
  return {
    title: lang === 'ru' ? 'Сбой интерфейса PiWright' : 'PiWright UI crash',
    message: lang === 'ru' ? 'Интерфейс аварийно завершился.' : 'The UI process crashed.',
    detail:
      lang === 'ru'
        ? `${cause} Интерфейсный процесс падает внутри песочницы Chromium — обычно это антивирус, встраивающийся в процессы (Kaspersky и т.п.), или нестандартная сборка Windows. «Перезапустить без песочницы» откроет окно, но изоляция интерфейса от системы будет слабее.`
        : `${cause} The UI process crashes inside the Chromium sandbox — usually caused by antivirus software injecting into processes (Kaspersky etc.) or an unusual Windows build. "Restart without sandbox" opens the window, but the UI will be less isolated from the system.`,
    buttons: lang === 'ru' ? ['Перезагрузить', 'Перезапустить без песочницы', 'Закрыть'] : ['Reload', 'Restart without sandbox', 'Quit'],
    restartNoSandboxIndex: 1
  }
}
