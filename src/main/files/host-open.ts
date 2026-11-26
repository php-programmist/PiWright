/** Открытие файлов/папок средствами ОС без Electron (headless-хост): spawn платформенного
 *  opener'а. Electron-хост использует shell.openPath/showItemInFolder — интеграция лучше. */
import { spawn } from 'node:child_process'

function openerArgs(path: string, reveal: boolean): { command: string; args: string[] } | null {
  switch (process.platform) {
    case 'win32':
      // explorer /select,ПУТЬ — папка с выделением; без /select — открытие (файл — ассоциированным приложением).
      return { command: 'explorer.exe', args: [reveal ? `/select,${path}` : path] }
    case 'darwin':
      return { command: 'open', args: reveal ? ['-R', path] : [path] }
    case 'linux':
      return { command: 'xdg-open', args: [path] }
    default:
      return null
  }
}

/** Открыть путь штатным приложением ОС. Возвращает '' или текст ошибки (как shell.openPath). */
export function openHostPath(path: string): Promise<string> {
  return runOpener(path, false)
}

/** Показать объект в файловом менеджере (папка с выделением). Бросает при ошибке запуска. */
export function revealHostItem(path: string): void {
  const plan = openerArgs(path, true)
  if (plan === null) throw new Error(`Reveal is not supported on ${process.platform}`)
  const child = spawn(plan.command, plan.args, { detached: true, stdio: 'ignore' })
  child.on('error', () => {})
  child.unref()
}

async function runOpener(path: string, reveal: boolean): Promise<string> {
  const plan = openerArgs(path, reveal)
  if (plan === null) return `Opening files is not supported on ${process.platform}`
  return await new Promise((resolve) => {
    const child = spawn(plan.command, plan.args, { detached: true, stdio: 'ignore' })
    child.on('error', (err) => resolve(err.message))
    child.on('spawn', () => {
      child.unref()
      resolve('')
    })
  })
}
