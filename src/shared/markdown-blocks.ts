/** Разбор markdown-документа на блоки для live-preview (фича 29): документ = lead +
 *  frontMatter + блоки с разделителями (seps) + tail. Срезы берутся из исходного текста
 *  как есть, поэтому joinMarkdownDoc(splitMarkdownDoc(text)) === text всегда. */

export interface MarkdownDoc {
  /** Пустые строки до первого блока. */
  lead: string
  /** Front matter `--- … ---` вместе с закрывающей строкой и переводом, либо null. */
  frontMatter: string | null
  /** Блоки (абзацы, заголовки, списки, цитаты, таблицы, fenced-код) с хвостовым переводом строки. */
  blocks: string[]
  /** seps[i] — пустые строки между blocks[i] и blocks[i+1]. */
  seps: string[]
  /** Пустые строки после последнего блока (до конца файла). */
  tail: string
}

interface Line {
  start: number
  /** Конец содержимого строки (без \r\n). */
  end: number
  /** 1, если после строки есть \n (сам \r остаётся в содержимом). */
  nl: number
}

function scanLines(text: string): Line[] {
  const lines: Line[] = []
  let i = 0
  while (i < text.length) {
    const start = i
    let end = i
    while (end < text.length && text[end] !== '\n') end++
    lines.push({ start, end, nl: end < text.length ? 1 : 0 })
    i = end + 1
  }
  return lines
}

const isBlank = (line: string): boolean => /^\s*$/.test(line)
const isHeading = (line: string): boolean => /^\s*#{1,6}(\s|$)/.test(line)
const isHr = (line: string): boolean => /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)
const isQuote = (line: string): boolean => /^\s*>/.test(line)
const isTableRow = (line: string): boolean => /^\s*\|/.test(line)
const isListItem = (line: string): boolean => /^\s*(?:[-*+]|\d{1,9}[.)])(?:\s|$)/.test(line)

function fenceMarker(line: string): string | null {
  const match = /^\s*(`{3,}|~{3,})/.exec(line)
  return match === null ? null : match[1][0]
}

function isSpecial(line: string): boolean {
  return (
    fenceMarker(line) !== null || isHeading(line) || isHr(line) || isQuote(line) || isTableRow(line) || isListItem(line)
  )
}

export function splitMarkdownDoc(text: string): MarkdownDoc {
  const lines = scanLines(text)
  const n = lines.length
  const content = (i: number): string => text.slice(lines[i].start, lines[i].end)

  let frontMatter: string | null = null
  let k = 0
  if (n > 0 && /^---\s*$/.test(content(0))) {
    let close = -1
    for (let j = 1; j < n; j++) {
      if (/^(?:---|\.\.\.)\s*$/.test(content(j))) {
        close = j
        break
      }
    }
    if (close > 0) {
      frontMatter = text.slice(0, lines[close].end + lines[close].nl)
      k = close + 1
    }
  }

  const blankThen = (blankIdx: number, predicate: (line: string) => boolean): boolean => {
    if (!isBlank(content(blankIdx)) || blankIdx + 1 >= n) return false
    return predicate(content(blankIdx + 1))
  }

  const collectBlock = (start: number): number => {
    const c = content(start)
    const marker = fenceMarker(c)
    if (marker !== null) {
      const closeRe = new RegExp(`^\\s*\\${marker}{3,}\\s*$`)
      let e = start + 1
      while (e < n && !closeRe.test(content(e))) e++
      return Math.min(e, n - 1)
    }
    if (isHeading(c) || isHr(c)) return start
    if (isQuote(c)) {
      let e = start + 1
      while (e < n) {
        if (isQuote(content(e))) e++
        else if (blankThen(e, isQuote)) e += 2
        else break
      }
      return e - 1
    }
    if (isTableRow(c)) {
      let e = start + 1
      while (e < n && isTableRow(content(e))) e++
      return e - 1
    }
    if (isListItem(c)) {
      let e = start + 1
      while (e < n) {
        const c2 = content(e)
        if (isListItem(c2) || (!isBlank(c2) && !isSpecial(c2))) e++
        else if (blankThen(e, isListItem)) e += 2
        else break
      }
      return e - 1
    }
    let e = start + 1
    while (e < n && !isBlank(content(e)) && !isSpecial(content(e))) e++
    return e - 1
  }

  const blocks: string[] = []
  const seps: string[] = []
  let lead = ''
  let tail = ''
  let pendingStart = -1
  let pendingEnd = -1
  let sawBlock = false

  const flushPending = (): void => {
    const slice = text.slice(lines[pendingStart].start, lines[pendingEnd].end + lines[pendingEnd].nl)
    if (sawBlock) seps.push(slice)
    else lead += slice
    pendingStart = -1
    pendingEnd = -1
  }

  while (k < n) {
    if (isBlank(content(k))) {
      if (pendingStart < 0) pendingStart = k
      pendingEnd = k
      k++
      continue
    }
    if (pendingStart >= 0) flushPending()
    const e = collectBlock(k)
    blocks.push(text.slice(lines[k].start, lines[e].end + lines[e].nl))
    sawBlock = true
    k = e + 1
  }
  if (pendingStart >= 0) tail = text.slice(lines[pendingStart].start)

  return { lead, frontMatter, blocks, seps, tail }
}

export function joinMarkdownDoc(doc: MarkdownDoc): string {
  let out = (doc.frontMatter ?? '') + doc.lead
  for (let i = 0; i < doc.blocks.length; i++) {
    out += doc.blocks[i]
    if (i < doc.seps.length) out += doc.seps[i]
  }
  return out + doc.tail
}
