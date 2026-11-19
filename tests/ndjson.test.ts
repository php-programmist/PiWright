import { describe, expect, it } from 'vitest'
import { NdjsonAccumulator } from '../src/main/pi/ndjson'

describe('NdjsonAccumulator', () => {
  it('emits only complete lines', () => {
    const lines: string[] = []
    const acc = new NdjsonAccumulator((l) => lines.push(l))
    acc.append('{"a":1}\n{"b"')
    expect(lines).toEqual(['{"a":1}'])
    acc.append(':2}\n')
    expect(lines).toEqual(['{"a":1}', '{"b":2}'])
  })

  it('strips carriage returns', () => {
    const lines: string[] = []
    const acc = new NdjsonAccumulator((l) => lines.push(l))
    acc.append('{"a":1}\r\n')
    expect(lines).toEqual(['{"a":1}'])
  })

  it('flush emits the remainder', () => {
    const lines: string[] = []
    const acc = new NdjsonAccumulator((l) => lines.push(l))
    acc.append('{"tail":true}')
    expect(lines).toEqual([])
    acc.flush()
    expect(lines).toEqual(['{"tail":true}'])
  })

  it('blank lines are skipped', () => {
    const lines: string[] = []
    const acc = new NdjsonAccumulator((l) => lines.push(l))
    acc.append('\n  \n{"a":1}\n')
    expect(lines).toEqual(['{"a":1}'])
  })
})
