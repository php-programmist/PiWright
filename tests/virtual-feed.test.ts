import { describe, expect, it } from 'vitest'
import { FEED_GAP, FEED_POOL, buildPrefix, computeRange, estimateEntryHeight, indexAtOffset, offsetOf, spacerHeights } from '../src/renderer/src/lib/virtual-feed'
import type { Entry } from '../src/renderer/src/stores/chat'

function user(id: number, text = 'hi'): Entry {
  return { kind: 'user', id, text }
}
function text(id: number, text = 'body'): Entry {
  return { kind: 'text', id, text, open: false }
}
function tool(id: number): Entry {
  return { kind: 'tool', id, call: { id: `c${id}`, name: 'bash', args: {}, parentToolCallId: null }, partial: '', result: null, children: [] }
}

describe('estimateEntryHeight', () => {
  it('даёт положительную оценку для всех видов записей', () => {
    const kinds: Entry[] = [user(1), text(2), { kind: 'thinking', id: 3, text: 'x', open: false }, tool(4), { kind: 'info', id: 5, text: 'x' }, { kind: 'error', id: 6, text: 'x' }, { kind: 'result', id: 7, usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: null, contextTokens: null, speed: null }, durationMs: null }]
    for (const e of kinds) expect(estimateEntryHeight(e)).toBeGreaterThan(0)
  })
})

describe('buildPrefix / offsetOf / indexAtOffset', () => {
  it('префикс — сумма высот с учётом замеров', () => {
    const items = [user(1), text(2), tool(3)]
    const heights = new Map([[2, 500]])
    const prefix = buildPrefix(items, heights)
    expect(prefix[0]).toBe(0)
    expect(prefix[1]).toBe(estimateEntryHeight(items[0]))
    expect(prefix[2]).toBe(prefix[1] + 500)
    expect(prefix[3]).toBe(prefix[2] + estimateEntryHeight(items[2]))
  })

  it('offsetOf учитывает зазоры, indexAtOffset находит владельца точки', () => {
    const items = [user(1), text(2), tool(3)]
    const heights = new Map([
      [1, 100],
      [2, 200],
      [3, 300]
    ])
    const prefix = buildPrefix(items, heights)
    expect(offsetOf(prefix, 0)).toBe(0)
    expect(offsetOf(prefix, 1)).toBe(100 + FEED_GAP)
    expect(offsetOf(prefix, 2)).toBe(300 + 2 * FEED_GAP)
    expect(indexAtOffset(prefix, 0)).toBe(0)
    expect(indexAtOffset(prefix, 99)).toBe(0)
    expect(indexAtOffset(prefix, 100 + FEED_GAP)).toBe(1)
    expect(indexAtOffset(prefix, 100 + FEED_GAP + 199)).toBe(1)
    expect(indexAtOffset(prefix, 300 + 2 * FEED_GAP + 9999)).toBe(2)
  })

  it('пустая лента — индекс 0', () => {
    expect(indexAtOffset(buildPrefix([], new Map()), 100)).toBe(0)
  })
})

describe('computeRange', () => {
  const heights = (n: number, h: number): Map<number, number> => {
    const m = new Map<number, number>()
    for (let i = 1; i <= n; i++) m.set(i, h)
    return m
  }

  it('короткая лента целиком в окне', () => {
    const prefix = buildPrefix([user(1), text(2)], new Map())
    expect(computeRange(prefix, FEED_POOL, 0)).toEqual({ start: 0, end: 2 })
  })

  it('окно центрируется на центре вьюпорта и не вылезает за края', () => {
    const n = 1000
    const prefix = buildPrefix(Array.from({ length: n }, (_, i) => user(i + 1)), heights(n, 100))
    // центр в районе записи 500
    const center = offsetOf(prefix, 500) + 50
    const { start, end } = computeRange(prefix, FEED_POOL, center)
    expect(end - start).toBe(FEED_POOL)
    expect(start).toBeGreaterThan(400)
    expect(start).toBeLessThan(500)
    // у самого низа окно прижато к хвосту
    const bottom = computeRange(prefix, FEED_POOL, Number.MAX_SAFE_INTEGER / 2)
    expect(bottom.end).toBe(n)
    expect(bottom.start).toBe(n - FEED_POOL)
    // у самого верха — к голове
    expect(computeRange(prefix, FEED_POOL, 0).start).toBe(0)
  })
})

describe('spacerHeights', () => {
  it('без окна (всё в DOM) распорки нулевые', () => {
    const prefix = buildPrefix([user(1), text(2)], new Map())
    expect(spacerHeights(prefix, 0, 2)).toEqual({ top: 0, bottom: 0 })
  })

  it('верхняя распорка покрывает высоты и зазоры убранных записей', () => {
    const items = [user(1), text(2), tool(3)]
    const heights = new Map([
      [1, 100],
      [2, 200],
      [3, 300]
    ])
    const prefix = buildPrefix(items, heights)
    // окно = только запись 2 (start=1, end=2)
    const { top, bottom } = spacerHeights(prefix, 1, 2)
    expect(top).toBe(100) // высота записи 0; зазор перед записью 1 даёт сам gap распорки
    expect(bottom).toBe(300) // запись 2; хвостовой зазор даёт gap перед распоркой
  })

  it('полная замена: сумма распорок + окна + зазоров = высоте полной ленты', () => {
    const n = 50
    const items = Array.from({ length: n }, (_, i) => user(i + 1))
    const heights = new Map<number, number>()
    for (let i = 1; i <= n; i++) heights.set(i, 100)
    const prefix = buildPrefix(items, heights)
    const { start, end } = { start: 10, end: 20 }
    const { top, bottom } = spacerHeights(prefix, start, end)
    const rendered = prefix[end] - prefix[start] + FEED_GAP * (end - start - 1)
    const full = prefix[n] + FEED_GAP * (n - 1)
    expect(top + rendered + bottom + 2 * FEED_GAP).toBe(full)
  })
})
