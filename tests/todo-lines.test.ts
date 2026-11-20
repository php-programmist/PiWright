import { describe, expect, it } from 'vitest'
import { PLAN_WIDGET_KEY, TODO_WIDGET_KEY, parseTodoLines } from '../src/shared/todo'

describe('parseTodoLines', () => {
  it('parses pi-todo JSON lines (one task per line)', () => {
    const items = parseTodoLines([
      '{"subject":"first","status":"completed"}',
      '{"subject":"second","status":"in_progress"}',
      '{"subject":"third","status":"pending"}'
    ])
    expect(items).toEqual([
      { subject: 'first', status: 'completed' },
      { subject: 'second', status: 'in_progress' },
      { subject: 'third', status: 'pending' }
    ])
  })

  it('parses plan-mode glyph lines and marks the first pending as current', () => {
    const items = parseTodoLines(['☑ done task', '☐ pending task', '☐ another'])
    expect(items).toEqual([
      { subject: 'done task', status: 'completed' },
      { subject: 'pending task', status: 'in_progress' },
      { subject: 'another', status: 'pending' }
    ])
  })

  it('keeps an explicit in_progress from JSON even with pending tasks', () => {
    const items = parseTodoLines(['{"subject":"a","status":"pending"}', '{"subject":"b","status":"in_progress"}'])
    expect(items.map((i) => i.status)).toEqual(['pending', 'in_progress'])
  })

  it('skips garbage lines and JSON without subject/status', () => {
    const items = parseTodoLines(['not json', '{"subject":"ok","status":"completed"}', '{"no":"status"}', ''])
    expect(items).toEqual([{ subject: 'ok', status: 'completed' }])
  })

  it('empty lines list gives empty plan', () => {
    expect(parseTodoLines([])).toEqual([])
  })

  it('widget keys are stable', () => {
    expect(TODO_WIDGET_KEY).toBe('pi-agent-desktop:todo')
    expect(PLAN_WIDGET_KEY).toBe('plan-todos')
  })
})
