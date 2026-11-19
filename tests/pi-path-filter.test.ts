import { describe, expect, it } from 'vitest'
import { filterSettingsPiPath } from '../src/main/pi/backends/factory'
import { toBackendPath } from '../src/main/sessions/session-catalog'
import type { Settings } from '../src/shared/ipc-contracts'

const SETTINGS: Settings = { wslDistro: 'Ubuntu', piPath: '', projects: [] }

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

describe('toBackendPath', () => {
  it('native passes through', async () => {
    expect(await toBackendPath({ kind: 'native', dir: 'C:\\p' }, SETTINGS, 'C:\\s\\a.jsonl')).toBe('C:\\s\\a.jsonl')
  })

  it('wsl UNC converts to path inside distro (no probe needed)', async () => {
    const unc = '\\\\wsl.localhost\\Ubuntu\\home\\u\\.pi\\agent\\sessions\\--home-u-p--\\a.jsonl'
    expect(await toBackendPath({ kind: 'wsl', dir: unc }, SETTINGS, unc)).toBe(
      '/home/u/.pi/agent/sessions/--home-u-p--/a.jsonl'
    )
  })

  it('wsl POSIX passes through', async () => {
    expect(await toBackendPath({ kind: 'wsl', dir: '/home/u/p' }, SETTINGS, '/home/u/p/x.jsonl')).toBe('/home/u/p/x.jsonl')
  })
})
