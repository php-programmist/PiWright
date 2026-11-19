/** Аргументы запуска: RPC-режим и, при восстановлении, файл сессии. Путь (а не id) — иначе для
 *  сессии из другого каталога pi спросит подтверждение в stdin и сломает протокол. */
export function piArgs(sessionPath?: string | null, extensionPath?: string | null): string[] {
  return [
    '--mode',
    'rpc',
    ...(extensionPath ? ['-e', extensionPath] : []),
    ...(sessionPath ? ['--session', sessionPath] : [])
  ]
}
