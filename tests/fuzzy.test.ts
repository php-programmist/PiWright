import { describe, expect, it } from 'vitest'
import { fuzzyMatch } from '../src/renderer/src/lib/fuzzy'

describe('fuzzyMatch', () => {
  it('empty query matches everything with zero score', () => {
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, positions: [] })
  })

  it('returns null when query is not a subsequence', () => {
    expect(fuzzyMatch('xz', 'file.ts')).toBeNull()
    expect(fuzzyMatch('ts', 'file')).toBeNull()
  })

  it('matches subsequence in order', () => {
    const m = fuzzyMatch('at', 'cat')
    expect(m).not.toBeNull()
    expect(m?.positions).toEqual([1, 2])
  })

  it('longer query never matches shorter text', () => {
    expect(fuzzyMatch('abcdef', 'abc')).toBeNull()
  })

  it('start-of-string match scores higher than middle', () => {
    const start = fuzzyMatch('ap', 'apple.ts')
    const middle = fuzzyMatch('pl', 'apple.ts')
    expect(start!.score).toBeGreaterThan(middle!.score)
  })

  it('word boundary after separator scores higher than inside a word', () => {
    const boundary = fuzzyMatch('us', 'src/user-service.ts')
    const inside = fuzzyMatch('us', 'src/hausund.ts')
    expect(boundary!.score).toBeGreaterThan(inside!.score)
  })

  it('consecutive characters score higher than gapped', () => {
    const consecutive = fuzzyMatch('se', 'session.ts')
    const gapped = fuzzyMatch('se', 's-o-m-e-t-h-i-n-g.ts')
    expect(consecutive!.score).toBeGreaterThan(gapped!.score)
  })

  it('case-insensitive', () => {
    const m = fuzzyMatch('AP', 'apple.ts')
    expect(m).not.toBeNull()
    expect(m?.positions).toEqual([0, 1])
  })

  it('positions point at matched characters', () => {
    const m = fuzzyMatch('fts', 'src/file.ts')
    expect(m?.positions).toEqual([4, 9, 10])
    expect('src/file.ts'[9]).toBe('t')
  })
})
