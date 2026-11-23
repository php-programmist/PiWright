import type { Entry } from '../stores/chat'

/** Пул записей ленты: столько максимум держим в DOM, остальные заменяют распорки. */
export const FEED_POOL = 100

/** Межзаписный отступ ленты; держать синхронно с gap у .transcript в app.css. */
export const FEED_GAP = 10

/** Оценка высоты записи, которой ещё не было в DOM (замеряется ResizeObserver-ом при рендере). */
export function estimateEntryHeight(entry: Entry): number {
  switch (entry.kind) {
    case 'user':
      return 56
    case 'text':
      return 220
    case 'thinking':
      return 48
    case 'tool':
      return 56
    case 'dialog':
      return 150
    case 'info':
      return 34
    case 'error':
      return 34
    case 'result':
      return 30
  }
}

type HeightOf = (entry: Entry) => number

/** Префиксные суммы высот: prefix[i] = сумма высот записей 0..i-1 (замеренные или оценочные). */
export function buildPrefix(items: readonly Entry[], heights: ReadonlyMap<number, number>, heightOf: HeightOf = estimateEntryHeight): number[] {
  const prefix = new Array<number>(items.length + 1)
  prefix[0] = 0
  for (let i = 0; i < items.length; i++) {
    const h = heights.get(items[i].id) ?? heightOf(items[i])
    prefix[i + 1] = prefix[i] + h
  }
  return prefix
}

/** Виртуальный отступ записи i от верха полной ленты (высоты + межзаписные зазоры). */
export function offsetOf(prefix: readonly number[], i: number): number {
  return prefix[i] + FEED_GAP * i
}

/** Индекс записи, владеющей точкой y (бинарный поиск по offsetOf). */
export function indexAtOffset(prefix: readonly number[], y: number): number {
  const len = prefix.length - 1
  if (len === 0) return 0
  let lo = 0
  let hi = len - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (offsetOf(prefix, mid) <= y) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** Окно рендера: пул записей, центрированный на точке центра вьюпорта. */
export function computeRange(prefix: readonly number[], pool: number, centerOffset: number): { start: number; end: number } {
  const len = prefix.length - 1
  if (len === 0) return { start: 0, end: 0 }
  if (len <= pool) return { start: 0, end: len }
  const mid = indexAtOffset(prefix, centerOffset)
  const start = Math.min(Math.max(0, mid - (pool >> 1)), len - pool)
  return { start, end: start + pool }
}

/**
 * Высоты распорок, подменяющих записи вне окна. Раскладка flex-колонки с gap:
 * распорка сверху компенсирует и зазоры убранных записей, снизу — хвостовые зазоры,
 * чтобы scrollHeight совпадал с полной лентой.
 */
export function spacerHeights(
  prefix: readonly number[],
  start: number,
  end: number
): { top: number; bottom: number } {
  const len = prefix.length - 1
  const top = start > 0 ? offsetOf(prefix, start) - FEED_GAP : 0
  const bottom = end < len ? prefix[len] - prefix[end] + FEED_GAP * (len - 1 - end) : 0
  return { top: Math.max(0, top), bottom: Math.max(0, bottom) }
}
