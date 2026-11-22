/** computeLanes (раскладка графа) и formatGitDate (даты в стиле PHPStorm). */
import { describe, expect, it } from 'vitest'
import { computeLanes, formatGitDate, laneColor } from '../src/renderer/src/views/git/git-log-model'

describe('computeLanes', () => {
  it('linear history stays on lane 0', () => {
    const rows = computeLanes([
      { hash: 'a', parents: ['b'] },
      { hash: 'b', parents: ['c'] },
      { hash: 'c', parents: [] }
    ])
    expect(rows.map((r) => r.lane)).toEqual([0, 0, 0])
    expect(rows[0]?.nextLanes).toEqual(['b'])
    expect(rows[2]?.nextLanes).toEqual([null])
  })

  it('branch puts the forked commit on a new lane', () => {
    // c — ветвление от b: родители a и b
    const rows = computeLanes([
      { hash: 'a', parents: ['c'] },
      { hash: 'c', parents: ['b', 'b2'] },
      { hash: 'b', parents: [] },
      { hash: 'b2', parents: [] }
    ])
    expect(rows[0]?.lane).toBe(0)
    // c: первая дорожка уходит в первого родителя b, второй родитель b2 — новая дорожка
    expect(rows[1]?.lane).toBe(0)
    expect(rows[1]?.nextLanes).toEqual(['b', 'b2'])
    expect(rows[1]?.edges).toEqual([0, 1])
  })

  it('merge continues into the lane of the merged parent', () => {
    // m сливает ветку: родители main и side, side уже ждёт на своей дорожке
    const rows = computeLanes([
      { hash: 'm', parents: ['main', 'side'] },
      { hash: 'side', parents: ['main'] },
      { hash: 'main', parents: [] }
    ])
    expect(rows[0]?.lane).toBe(0)
    expect(rows[0]?.edges).toEqual([0, 1])
    expect(rows[1]?.lane).toBe(1)
  })

  it('free lane is reused', () => {
    const rows = computeLanes([
      { hash: 'a', parents: ['b', 'x'] },
      { hash: 'b', parents: [] },
      { hash: 'x', parents: [] }
    ])
    // после a: lane0 → b, lane1 → x; b освобождает lane0, x — lane1
    expect(rows[1]?.lane).toBe(0)
    expect(rows[2]?.lane).toBe(1)
  })
})

describe('laneColor', () => {
  it('cycles the palette', () => {
    expect(laneColor(0)).toBe(laneColor(8))
    expect(laneColor(1)).not.toBe(laneColor(0))
  })
})

describe('formatGitDate', () => {
  const now = new Date(2026, 10, 22, 18, 0) // 2026-11-22 18:00

  it('just now for less than a minute', () => {
    const ts = Math.floor(now.getTime() / 1000) - 30
    expect(formatGitDate(ts, 'ru', now)).toBe('только что')
    expect(formatGitDate(ts, 'en', now)).toBe('just now')
  })

  it('minutes ago with ru pluralization', () => {
    const ts = Math.floor(now.getTime() / 1000) - 22 * 60
    expect(formatGitDate(ts, 'ru', now)).toBe('22 минуты назад')
    const ts1 = Math.floor(now.getTime() / 1000) - 1 * 60
    expect(formatGitDate(ts1, 'ru', now)).toBe('1 минуту назад')
    const ts5 = Math.floor(now.getTime() / 1000) - 5 * 60
    expect(formatGitDate(ts5, 'ru', now)).toBe('5 минут назад')
    expect(formatGitDate(ts, 'en', now)).toBe('22 minutes ago')
  })

  it('today and yesterday with time', () => {
    const today = new Date(2026, 10, 22, 9, 5).getTime() / 1000
    expect(formatGitDate(today, 'ru', now)).toBe('Сегодня 09:05')
    expect(formatGitDate(today, 'en', now)).toBe('Today 09:05')
    const yesterday = new Date(2026, 10, 21, 23, 1).getTime() / 1000
    expect(formatGitDate(yesterday, 'ru', now)).toBe('Вчера 23:01')
    expect(formatGitDate(yesterday, 'en', now)).toBe('Yesterday 23:01')
  })

  it('day month for this year, full date for older', () => {
    const march = new Date(2026, 2, 5, 12, 30).getTime() / 1000
    expect(formatGitDate(march, 'ru', now)).toBe('5 мар, 12:30')
    expect(formatGitDate(march, 'en', now)).toBe('5 Mar, 12:30')
    const old = new Date(2024, 0, 2, 3, 4).getTime() / 1000
    expect(formatGitDate(old, 'ru', now)).toBe('2024-01-02')
  })
})
