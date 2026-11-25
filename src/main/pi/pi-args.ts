/** Аргументы запуска: RPC-режим и, при восстановлении, файл сессии. Путь (а не id) — иначе для
 *  сессии из другого каталога pi спросит подтверждение в stdin и сломает протокол.
 *  Доп. аргументы из настроек — в конец (сплит по пробелам, двойные кавычки для путей с пробелами). */
export function splitArgs(extra: string): string[] {
  const args: string[] = []
  let current = ''
  let quoted = false
  for (const ch of extra) {
    if (ch === '"') {
      quoted = !quoted
    } else if (ch === ' ' && !quoted) {
      if (current.length > 0) args.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current.length > 0) args.push(current)
  return args
}

export function piArgs(
  sessionPath?: string | null,
  extensionPaths: readonly (string | null)[] = [],
  extraArgs: string[] = []
): string[] {
  return [
    '--mode',
    'rpc',
    ...extensionPaths.flatMap((path) => (path === null ? [] : ['-e', path])),
    ...(sessionPath ? ['--session', sessionPath] : []),
    ...extraArgs
  ]
}

/** Файл сессии из готовых аргументов (пара `--session <путь>` из piArgs) — ключ attach в демоне. */
export function sessionFileFromArgs(args: readonly string[]): string | null {
  const index = args.indexOf('--session')
  const file = index >= 0 ? args[index + 1] : undefined
  return typeof file === 'string' && file.length > 0 ? file : null
}
