import { describe, expect, it } from 'vitest'
import { pathDirsFromEnv, resolveLocalPi, windowsPiCandidates } from '../src/main/pi/backends/native'

const exeNames = ['pi']

describe('resolveLocalPi', () => {
  it('settings path wins when it exists', () => {
    const r = resolveLocalPi(
      '/custom/pi',
      ['/usr/bin'],
      exeNames,
      ['/home/x/.local/bin/pi'],
      (p) => p === '/custom/pi' || p === '/usr/bin/pi'
    )
    expect(r).toBe('/custom/pi')
  })

  it('blank settings path is ignored', () => {
    const r = resolveLocalPi(
      '  ',
      ['/usr/local/bin'],
      exeNames,
      [],
      (p) => p === '/usr/local/bin/pi'
    )
    expect(r).toBe('/usr/local/bin/pi')
  })

  it('settings path that does not exist falls through to PATH', () => {
    const r = resolveLocalPi(
      '/gone/pi',
      ['/a', '/b'],
      exeNames,
      [],
      (p) => p === '/b/pi'
    )
    expect(r).toBe('/b/pi')
  })

  it('falls through to known candidates when not on PATH', () => {
    const r = resolveLocalPi(
      null,
      ['/a'],
      exeNames,
      ['/opt/pi', '/home/x/.local/bin/pi'],
      (p) => p === '/home/x/.local/bin/pi'
    )
    expect(r).toBe('/home/x/.local/bin/pi')
  })

  it('windows exe-name variants are tried per PATH dir', () => {
    const r = resolveLocalPi(
      null,
      ['C:\\npm'],
      ['pi.cmd', 'pi.exe'],
      [],
      (p) => p === 'C:\\npm\\pi.exe'
    )
    expect(r).toBe('C:\\npm\\pi.exe')
  })

  it('returns null when nothing found', () => {
    expect(resolveLocalPi(null, ['/a'], exeNames, [], () => false)).toBeNull()
  })
})

describe('pathDirsFromEnv', () => {
  it('splits on semicolon and drops blanks', () => {
    expect(pathDirsFromEnv('C:\\a;;C:\\b\\')).toEqual(['C:\\a', 'C:\\b'])
  })
})

describe('windowsPiCandidates', () => {
  it('points at the installer location', () => {
    expect(windowsPiCandidates('C:\\Users\\u')).toEqual(['C:\\Users\\u\\.pi\\agent\\bin\\pi.cmd'])
  })
})
