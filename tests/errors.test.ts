import { describe, expect, it } from 'vitest'
import { errorMessage } from '../src/shared/errors'

describe('errorMessage', () => {
  it('AggregateError (multi-address connect): joins inner messages, message is empty', () => {
    const err = new AggregateError([new Error('connect ECONNREFUSED 127.0.0.1:5435'), new Error('connect ECONNREFUSED ::1:5435')])
    expect(err.message).toBe('')
    expect(errorMessage(err)).toBe('connect ECONNREFUSED 127.0.0.1:5435; connect ECONNREFUSED ::1:5435')
  })

  it('AggregateError: dedupes identical inner messages, skips empty ones', () => {
    const err = new AggregateError([new Error('connect ECONNREFUSED localhost:5435'), new Error('connect ECONNREFUSED localhost:5435'), new Error('')])
    expect(errorMessage(err)).toBe('connect ECONNREFUSED localhost:5435')
  })

  it('plain Error keeps message; empty message and non-Error fall back to String(err)', () => {
    expect(errorMessage(new Error('auth failed'))).toBe('auth failed')
    expect(errorMessage(new Error(''))).toBe('Error')
    expect(errorMessage('boom')).toBe('boom')
  })
})
