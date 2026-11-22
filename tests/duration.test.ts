import { describe, expect, it } from 'vitest'
import { formatCompactDuration } from '../src/renderer/src/lib/duration'

describe('formatCompactDuration', () => {
  it('formats only significant units, seconds always', () => {
    expect(formatCompactDuration(0)).toBe('0s')
    expect(formatCompactDuration(500)).toBe('1s')
    expect(formatCompactDuration(5_000)).toBe('5s')
    expect(formatCompactDuration(65_000)).toBe('1m 5s')
    expect(formatCompactDuration(600_000)).toBe('10m 0s')
    expect(formatCompactDuration(7_545_000)).toBe('2h 5m 45s')
    expect(formatCompactDuration(-1)).toBe('0s')
  })
})
