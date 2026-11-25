import { describe, expect, it } from 'vitest'
import {
  aggregate,
  buildBuckets,
  canonicalProject,
  hourStart,
  dayStart,
  monthStart,
  projectName,
  scanSessionLines,
  type Counts,
  type StatsFileEntry
} from '../src/main/stats/stats-service'

const DAY_MS = 24 * 3_600_000

const HEADER = JSON.stringify({ type: 'session', version: 3, id: 's1', cwd: 'D:\\Projects\\demo' })

function assistantMessage(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'message',
    id: 'm1',
    timestamp: '2026-06-15T10:30:00.000Z',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      model: 'test-model',
      usage: { input: 100, output: 50, cacheRead: 200, cacheWrite: 0, totalTokens: 350 },
      timestamp: Date.UTC(2026, 5, 15, 10, 30),
      ...overrides
    }
  })
}

describe('scanSessionLines', () => {
  it('returns null for non-session file', async () => {
    const result = await scanSessionLines(['{"type":"other"}'])
    expect(result).toBeNull()
  })

  it('aggregates assistant usage into hourly and daily buckets per model', async () => {
    const result = await scanSessionLines([HEADER, assistantMessage()])
    expect(result).not.toBeNull()
    expect(result?.cwd).toBe('D:\\Projects\\demo')
    const ts = Date.UTC(2026, 5, 15, 10, 30)
    const hourKey = Object.keys(result?.hourly ?? {})[0]
    const dayKey = Object.keys(result?.daily ?? {})[0]
    expect(hourKey).toBe(`${hourStart(ts)}|test-model`)
    expect(dayKey).toBe(`${dayStart(ts)}|test-model`)
    expect(result?.hourly[hourKey]).toEqual([100, 50, 200])
    expect(result?.daily[dayKey]).toEqual([100, 50, 200])
  })

  it('skips user messages, zero usage and records without usage', async () => {
    const user = JSON.stringify({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } })
    const zero = assistantMessage({ usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } })
    const noUsage = JSON.stringify({ type: 'message', message: { role: 'assistant', content: [] } })
    const result = await scanSessionLines([HEADER, user, zero, noUsage])
    expect(result?.hourly).toEqual({})
    expect(result?.daily).toEqual({})
  })

  it('sums multiple messages of the same hour and model', async () => {
    const result = await scanSessionLines([HEADER, assistantMessage(), assistantMessage()])
    const key = Object.keys(result?.hourly ?? {})[0]
    expect(result?.hourly[key]).toEqual([200, 100, 400])
  })
})

describe('canonicalProject', () => {
  it('collapses worktrees into the main project', () => {
    expect(canonicalProject('D:\\Projects\\demo\\.pi\\worktrees\\feat')).toBe('d:/projects/demo')
    expect(canonicalProject('/home/u/proj/.pi/worktrees/w1')).toBe('/home/u/proj')
  })

  it('normalizes separators and windows case', () => {
    expect(canonicalProject('D:\\Projects\\Demo')).toBe('d:/projects/demo')
    expect(canonicalProject('/home/u/proj')).toBe('/home/u/proj')
  })

  it('derives display name from the key', () => {
    expect(projectName('d:/projects/demo')).toBe('demo')
    expect(projectName('/home/u/proj')).toBe('proj')
  })
})

describe('buildBuckets', () => {
  it('day window: 24 hourly buckets ending at the current hour', () => {
    const now = new Date(2026, 5, 15, 14, 30).getTime()
    const { granularity, starts } = buildBuckets('day', undefined, undefined, now)
    expect(granularity).toBe('hour')
    expect(starts).toHaveLength(24)
    expect(starts[23]).toBe(hourStart(now))
    expect(starts[22]).toBe(hourStart(now) - 3600_000)
  })

  it('month window: one daily bucket per day of the current month', () => {
    const now = new Date(2026, 5, 15, 14, 30).getTime()
    const { granularity, starts } = buildBuckets('month', undefined, undefined, now)
    expect(granularity).toBe('day')
    expect(starts).toHaveLength(30)
    expect(starts[0]).toBe(new Date(2026, 5, 1).getTime())
  })

  it('year window: 12 monthly buckets from January', () => {
    const now = new Date(2026, 5, 15).getTime()
    const { granularity, starts } = buildBuckets('year', undefined, undefined, now)
    expect(granularity).toBe('month')
    expect(starts).toHaveLength(12)
    expect(starts[0]).toBe(new Date(2026, 0, 1).getTime())
    expect(starts[11]).toBe(new Date(2026, 11, 1).getTime())
  })

  it('custom window: arbitrary month, daily buckets', () => {
    const now = new Date(2026, 5, 15).getTime()
    const { granularity, starts } = buildBuckets('custom', 2, 2025, now)
    expect(granularity).toBe('day')
    expect(starts).toHaveLength(28)
    expect(starts[0]).toBe(new Date(2025, 1, 1).getTime())
  })
})

function entry(cwd: string, hourly: Record<string, Counts>, daily: Record<string, Counts>): StatsFileEntry {
  return { size: 1, mtimeMs: 1, cwd, hourly, daily }
}

describe('aggregate', () => {
  const hour = hourStart(Date.UTC(2026, 5, 15, 10, 0))
  const day = dayStart(Date.UTC(2026, 5, 15, 10, 0))

  it('sums across projects and models into the bucket grid', () => {
    const files = {
      a: entry('D:\\Projects\\demo', { [`${hour}|m1`]: [10, 5, 2] }, { [`${day}|m1`]: [10, 5, 2] }),
      b: entry('/home/u/proj', { [`${hour}|m2`]: [7, 3, 1] }, { [`${day}|m2`]: [7, 3, 1] })
    }
    const { points, projects, models } = aggregate(files, [hour], 'hour', null, null)
    expect(points).toEqual([{ t: hour, input: 17, output: 8, cacheRead: 3 }])
    expect(projects.map((p) => p.name).sort()).toEqual(['demo', 'proj'])
    expect(models).toEqual(['m1', 'm2'])
  })

  it('filters by project (worktree collapsed) and model', () => {
    const files = {
      a: entry('D:\\Projects\\demo', { [`${hour}|m1`]: [10, 5, 2] }, {}),
      b: entry('D:\\Projects\\demo\\.pi\\worktrees\\feat', { [`${hour}|m1`]: [1, 1, 1] }, {}),
      c: entry('/home/u/proj', { [`${hour}|m2`]: [7, 3, 1] }, {})
    }
    const filtered = aggregate(files, [hour], 'hour', 'd:/projects/demo', 'm1')
    expect(filtered.points).toEqual([{ t: hour, input: 11, output: 6, cacheRead: 3 }])
    const byModel = aggregate(files, [hour], 'hour', null, 'm2')
    expect(byModel.points).toEqual([{ t: hour, input: 7, output: 3, cacheRead: 1 }])
  })

  it('keeps daily and hourly maps apart by granularity', () => {
    const files = { a: entry('/p', { [`${hour}|m`]: [10, 0, 0] }, { [`${day}|m`]: [99, 0, 0] }) }
    expect(aggregate(files, [hour], 'hour', null, null).points[0].input).toBe(10)
    expect(aggregate(files, [day], 'day', null, null).points[0].input).toBe(99)
  })

  it('rolls daily buckets up into month buckets', () => {
    const month = monthStart(day)
    const files = {
      a: entry('/p', {}, { [`${day}|m`]: [10, 5, 1], [`${day + DAY_MS}|m`]: [20, 5, 3] })
    }
    const { points } = aggregate(files, [month], 'month', null, null)
    expect(points).toEqual([{ t: month, input: 30, output: 10, cacheRead: 4 }])
  })

  it('fills missing buckets with zeros', () => {
    const files = { a: entry('/p', { [`${hour}|m`]: [10, 0, 0] }, {}) }
    const points = aggregate(files, [hour - 3600_000, hour], 'hour', null, null).points
    expect(points).toEqual([
      { t: hour - 3600_000, input: 0, output: 0, cacheRead: 0 },
      { t: hour, input: 10, output: 0, cacheRead: 0 }
    ])
  })
})
