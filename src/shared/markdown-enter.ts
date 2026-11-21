/** "Smart Enter" for the markdown live editor: continues or ends a list item inside a block.
 *  Text is expected to use LF line endings (same as textarea.value reports). */

export interface ListEnterResult {
  text: string
  caret: number
}

const ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]*)(.*)$/
const FENCE = /^\s*(`{3,}|~{3,})/
const CHECKBOX = /^(\[[ xX]\])([ \t]*)(.*)$/

function isInsideFence(before: string): boolean {
  let marker: string | null = null
  for (const line of before.split('\n')) {
    const match = FENCE.exec(line)
    if (match === null) continue
    if (marker === null) marker = match[1][0]
    else if (match[1][0] === marker) marker = null
  }
  return marker !== null
}

export function continueListItem(text: string, selStart: number, selEnd: number): ListEnterResult | null {
  if (selStart !== selEnd || selStart < 0 || selStart > text.length) return null
  const caret = selStart
  const lineStart = text.lastIndexOf('\n', caret - 1) + 1
  const found = text.indexOf('\n', caret)
  const lineEnd = found < 0 ? text.length : found
  if (isInsideFence(text.slice(0, lineStart))) return null

  const rawLine = text.slice(lineStart, lineEnd)
  const match = ITEM.exec(rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine)
  if (match === null) return null
  const [, indent, marker, gap, rest] = match
  if (gap === '' && rest !== '') return null
  const markerStart = lineStart + indent.length
  if (caret < markerStart) return null

  const checkbox = CHECKBOX.exec(rest)
  const body = checkbox === null ? rest : checkbox[3]
  if (body.trim() === '') {
    const stop = lineEnd < text.length ? lineEnd + 1 : lineEnd
    return { text: text.slice(0, lineStart) + text.slice(stop), caret: lineStart }
  }

  const markerEnd = markerStart + marker.length + gap.length
  if (caret < markerEnd) return null

  let nextMarker = marker
  if (/^\d+[.)]$/.test(marker)) {
    nextMarker = `${Number(marker.slice(0, -1)) + 1}${marker.slice(-1)}`
  }
  const prefix = indent + nextMarker + gap + (checkbox === null ? '' : `[ ]${checkbox[2]}`)

  let tail = text.slice(caret, lineEnd)
  let cr = ''
  if (tail.endsWith('\r')) {
    cr = '\r'
    tail = tail.slice(0, -1)
  }
  return { text: `${text.slice(0, caret)}\n${prefix}${tail}${cr}${text.slice(lineEnd)}`, caret: caret + 1 + prefix.length }
}
