import { describe, expect, it } from 'vitest'
import { cacheHitOf, percentColor } from '../src/shared/agent-events'

function rgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)]
}

describe('percentColor', () => {
  it('0% is green (g > r), 100% is red (r > g)', () => {
    const [r0, g0] = rgb(percentColor(0))
    expect(g0).toBeGreaterThan(r0)
    const [r100, g100] = rgb(percentColor(100))
    expect(r100).toBeGreaterThan(g100)
  })

  it('50% is yellow (r = g, blue smallest)', () => {
    const [r, g, b] = rgb(percentColor(50))
    expect(r).toBe(g)
    expect(b).toBeLessThan(r)
  })

  it('clamps out-of-range values to the 0..100 buckets', () => {
    expect(percentColor(150)).toBe(percentColor(100))
    expect(percentColor(-5)).toBe(percentColor(0))
  })

  it('buckets of 10% share one color', () => {
    expect(percentColor(0)).toBe(percentColor(9))
    expect(percentColor(10)).not.toBe(percentColor(9))
  })
})

describe('cacheHitOf', () => {
  it('read share of the whole prompt', () => {
    expect(cacheHitOf(0, 9000, 1000)).toBe(90)
    expect(cacheHitOf(1000, 9000, 1000)).toBe(82)
  })

  it('null when the prompt is empty', () => {
    expect(cacheHitOf(0, 0, 0)).toBeNull()
  })
})
