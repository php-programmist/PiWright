/** Путь аргумента инструмента → путь относительно корня проекта (слэши вперёд).
 *  Вне проекта — null. Чистая функция без node:path: живёт и в renderer, и в тестах. */
export type ChatLinkTarget = { kind: 'external'; url: string } | { kind: 'file'; path: string }

/** href из markdown-ссылки в чате → цель клика.
 *  http(s)/mailto — external; остальное трактуется как путь файла проекта
 *  (относительный, абсолютный, file://; `#якорь` внутри пути срезается).
 *  Не распознано — null. */
export function resolveChatLink(projectDir: string, href: string): ChatLinkTarget | null {
  let raw = href.trim()
  if (raw === '' || raw.startsWith('#')) return null
  if (/^https?:\/\/|^mailto:/i.test(raw)) return { kind: 'external', url: raw }
  if (/^file:/i.test(raw)) {
    raw = raw.replace(/^file:\/\//i, '')
    raw = raw.replace(/^\/([a-z]:\/)/i, '$1')
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[a-z]:[\\/]/i.test(raw)) return null
  if (/[a-z0-9+.-]+:\/\//i.test(raw)) return null
  try {
    raw = decodeURIComponent(raw)
  } catch {
    return null
  }
  raw = raw.replace(/#.*$/, '')
  if (raw === '') return null
  const path = toProjectRelative(projectDir, raw)
  if (path === null) return null
  const stripped = path.replace(/^(\.\/)+/, '')
  return stripped === '' ? null : { kind: 'file', path: stripped }
}

/** src картинки из markdown → путь относительно корня проекта (слэши вперёд), или null.
 *  baseDir — каталог md-файла относительно корня проекта ('' — корень); относительный src
 *  резолвится от него, абсолютный — от корня проекта. data:/http(s) и прочие схемы — null
 *  (рендерятся как есть). */
export function resolveMarkdownImage(projectDir: string, baseDir: string, src: string): string | null {
  let raw = src.trim()
  if (raw === '') return null
  if (/^data:/i.test(raw)) return null
  if (/^file:/i.test(raw)) {
    raw = raw.replace(/^file:\/\//i, '')
    raw = raw.replace(/^\/([a-z]:\/)/i, '$1')
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[a-z]:[\\/]/i.test(raw)) {
    return null
  }
  try {
    raw = decodeURIComponent(raw)
  } catch {
    return null
  }
  raw = raw.replace(/#.*$/, '').replace(/\\/g, '/')
  if (raw === '') return null
  if (/^\/(?!\/)/.test(raw)) return raw.replace(/^\/+/, '') || null
  const absolute = /^[a-z]:\//i.test(raw) || raw.startsWith('/')
  const relative = absolute ? toProjectRelative(projectDir, raw) : joinFromBase(baseDir, raw)
  if (relative === null) return null
  const stripped = relative.replace(/^(\.\/)+/, '')
  return stripped === '' ? null : stripped
}

function joinFromBase(baseDir: string, rawPath: string): string | null {
  const base = baseDir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const parts: string[] = []
  for (const segment of (base === '' ? [] : base.split('/')).concat(rawPath.split('/'))) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (parts.length === 0) return null
      parts.pop()
      continue
    }
    parts.push(segment)
  }
  return parts.join('/')
}

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
