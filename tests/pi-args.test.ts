import { describe, expect, it } from 'vitest'
import { piArgs, splitArgs } from '../src/main/pi/pi-args'

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

  it('extra args go last', () => {
    expect(piArgs(null, null, ['--no-extensions', '-e', 'x'])).toEqual(['--mode', 'rpc', '--no-extensions', '-e', 'x'])
  })
})

describe('splitArgs', () => {
  it('splits on whitespace', () => {
    expect(splitArgs('  --no-extensions   -e x ')).toEqual(['--no-extensions', '-e', 'x'])
  })

  it('keeps double-quoted parts together', () => {
    expect(splitArgs('-e "C:\Program Files\ext"')).toEqual(['-e', 'C:\Program Files\ext'])
  })

  it('empty and whitespace-only give empty list', () => {
    expect(splitArgs('')).toEqual([])
    expect(splitArgs('   ')).toEqual([])
  })
})
