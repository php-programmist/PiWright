import { describe, expect, it } from 'vitest'
import { sessionStatus } from '../src/main/pi/session-status'

describe('sessionStatus (порт RemoteProtocol.sessionStatus)', () => {
  it('confirm wins over everything', () => {
    expect(sessionStatus(true, ['confirm', 'input'])).toBe('confirm')
    expect(sessionStatus(false, ['confirm'])).toBe('confirm')
  })

  it('question over busy', () => {
    expect(sessionStatus(true, ['input'])).toBe('question')
    expect(sessionStatus(false, ['select'])).toBe('question')
  })

  it('busy over idle', () => {
    expect(sessionStatus(true, [])).toBe('busy')
  })

  it('idle otherwise', () => {
    expect(sessionStatus(false, [])).toBe('idle')
  })
})
