/** Путь аргумента инструмента → путь относительно корня проекта (слэши вперёд).
 *  Вне проекта — null. Чистая функция без node:path: живёт и в renderer, и в тестах. */
export function toProjectRelative(projectDir: string, rawPath: string): string | null {
  const normalize = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const raw = normalize(rawPath)
  if (!/^[a-z]:\//i.test(raw) && !raw.startsWith('/')) return normalize(rawPath)
  const dir = normalize(projectDir)
  const dirLower = dir.toLowerCase()
  const rawLower = raw.toLowerCase()
  if (rawLower === dirLower) return null
  if (rawLower.startsWith(dirLower + '/')) return raw.slice(dir.length + 1)
  const uncTail = /^\/\/wsl(?:\.localhost|\$)\/[^/]+(\/.+)$/i.exec(dir)
  if (uncTail !== null) {
    const tail = uncTail[1]
    if (rawLower.startsWith(tail.toLowerCase() + '/')) return raw.slice(tail.length + 1)
  }
  return null
}
