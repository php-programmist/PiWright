/** Платформа main-процесса (через preload): renderer платформо-слепой, ветки UI — отсюда. */
export const platform = window.piwright.platform
export const isWindows = platform === 'win32'
