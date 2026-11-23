/** Нечёткий поиск подпоследовательностью (как в PHPStorm): символы запроса встречаются
 *  в тексте по порядку. Бонусы — начало строки, граница слова, подряд идущие совпадения;
 *  штраф — разрыв между совпадениями. Пустой запрос совпадает со всем (score 0). */
export interface FuzzyMatch {
  score: number
  /** Индексы символов текста, попавших в совпадение (для подсветки). */
  positions: number[]
}

const WORD_BOUNDARY_CHARS = new Set(['/', '\\', '_', '-', '.', ' ', '(', '[', '{'])

export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (q.length === 0) return { score: 0, positions: [] }
  if (q.length > t.length) return null
  let score = 0
  let prev = -2
  const positions: number[] = []
  let ti = 0
  for (let qi = 0; qi < q.length; qi++) {
    const found = t.indexOf(q[qi], ti)
    if (found === -1) return null
    score += 10
    if (found === 0 || WORD_BOUNDARY_CHARS.has(t[found - 1])) score += 8
    if (found === prev + 1) score += 6
    else score -= Math.min(found - prev - 1, 10)
    positions.push(found)
    prev = found
    ti = found + 1
  }
  return { score, positions }
}
