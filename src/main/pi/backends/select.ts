/** Выбор бэкенда. Порт `exec/BackendSelection.kt`. */

export type BackendKind = 'native' | 'wsl'

/** mode — сырое значение настройки ("auto" | "wsl" | "native"; регистр не важен, прочее = auto). */
export function selectBackendKind(mode: string, isWindows: boolean, hasWsl: boolean): BackendKind {
  switch (mode.trim().toLowerCase()) {
    case 'native':
      return 'native'
    case 'wsl':
      return 'wsl'
    default:
      return isWindows && hasWsl ? 'wsl' : 'native'
  }
}
