import { describe, expect, it } from 'vitest'
import { filterSettingsPiPath } from '../src/main/pi/backends/factory'

describe('filterSettingsPiPath', () => {
  it('empty setting yields null (auto-resolve)', () => {
    expect(filterSettingsPiPath('native', '')).toBeNull()
    expect(filterSettingsPiPath('wsl', '  ')).toBeNull()
  })

  it('wsl accepts only POSIX paths', () => {
    expect(filterSettingsPiPath('wsl', '/usr/local/bin/pi')).toBe('/usr/local/bin/pi')
    expect(filterSettingsPiPath('wsl', '~/.local/bin/pi')).toBe('~/.local/bin/pi')
    expect(filterSettingsPiPath('wsl', 'C:\\Users\\x\\.pi\\agent\\bin\\pi.cmd')).toBeNull()
  })

  it('native rejects POSIX paths', () => {
    expect(filterSettingsPiPath('native', 'C:\\Users\\x\\.pi\\agent\\bin\\pi.cmd')).toBe('C:\\Users\\x\\.pi\\agent\\bin\\pi.cmd')
    expect(filterSettingsPiPath('native', 'pi.cmd')).toBe('pi.cmd')
    expect(filterSettingsPiPath('native', '/usr/bin/pi')).toBeNull()
  })
})
