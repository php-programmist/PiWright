import { describe, expect, it } from 'vitest'
import { piArgs } from '../src/main/pi/pi-args'

describe('piArgs', () => {
  it('rpc mode without session or extension', () => {
    expect(piArgs(null)).toEqual(['--mode', 'rpc'])
  })

  it('session path goes after rpc mode', () => {
    expect(piArgs('/s.jsonl')).toEqual(['--mode', 'rpc', '--session', '/s.jsonl'])
  })

  it('extension path is passed with -e before session', () => {
    expect(piArgs('/s.jsonl', '/ext/ask-question')).toEqual([
      '--mode',
      'rpc',
      '-e',
      '/ext/ask-question',
      '--session',
      '/s.jsonl'
    ])
  })
})
