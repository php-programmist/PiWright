import { describe, expect, it } from 'vitest'
import { selectBackendKind } from '../src/main/pi/backends/select'

describe('selectBackendKind', () => {
  it('native mode always local', () => {
    expect(selectBackendKind('native', true, true)).toBe('native')
    expect(selectBackendKind('native', false, false)).toBe('native')
  })

  it('wsl mode always wsl even without distro', () => {
    expect(selectBackendKind('wsl', true, false)).toBe('wsl')
    expect(selectBackendKind('wsl', false, false)).toBe('wsl')
  })

  it('auto on windows with wsl distro picks wsl', () => {
    expect(selectBackendKind('auto', true, true)).toBe('wsl')
  })

  it('auto on windows without wsl distro picks local', () => {
    expect(selectBackendKind('auto', true, false)).toBe('native')
  })

  it('auto off windows always local', () => {
    expect(selectBackendKind('auto', false, true)).toBe('native')
    expect(selectBackendKind('auto', false, false)).toBe('native')
  })

  it('blank or unknown mode behaves as auto', () => {
    expect(selectBackendKind('', true, true)).toBe('wsl')
    expect(selectBackendKind('nonsense', false, true)).toBe('native')
  })

  it('mode is case insensitive', () => {
    expect(selectBackendKind('NATIVE', true, true)).toBe('native')
  })
})
