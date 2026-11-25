import { describe, expect, it } from 'vitest'
import { availableProfiles, defaultProfileId, findGitBash, resolveSpawn } from '../src/main/terminal/profiles'

import type { ProfileAvailability } from '../src/main/terminal/profiles'
import type { ProjectEntry } from '../src/shared/ipc-contracts'

const FULL: ProfileAvailability = { gitBashPath: 'C:\\Program Files\\Git\\bin\\bash.exe', wslDistro: 'Ubuntu', sshServer: null }
const NO_GITBASH: ProfileAvailability = { gitBashPath: null, wslDistro: 'Ubuntu', sshServer: null }
const NO_WSL: ProfileAvailability = { gitBashPath: FULL.gitBashPath, wslDistro: null, sshServer: null }

const NATIVE: ProjectEntry = { kind: 'native', dir: 'C:\\Projects\\demo' }
const WSL: ProjectEntry = { kind: 'wsl', dir: '\\\\wsl.localhost\\Ubuntu\\home\\u\\demo' }

describe('availableProfiles', () => {
  it('lists all four when everything is available', () => {
    expect(availableProfiles(NATIVE, FULL)).toEqual([
      { id: 'powershell', label: 'PowerShell' },
      { id: 'cmd', label: 'cmd' },
      { id: 'gitbash', label: 'Git Bash' },
      { id: 'wsl', label: 'Ubuntu' }
    ])
  })

  it('hides git bash when not found', () => {
    expect(availableProfiles(NATIVE, NO_GITBASH).map((p) => p.id)).toEqual(['powershell', 'cmd', 'wsl'])
  })

  it('hides wsl when no distro', () => {
    expect(availableProfiles(NATIVE, NO_WSL).map((p) => p.id)).toEqual(['powershell', 'cmd', 'gitbash'])
  })
})

describe('defaultProfileId', () => {
  it('is powershell for native projects', () => {
    expect(defaultProfileId('native', FULL)).toBe('powershell')
  })

  it('is wsl for wsl projects with a distro', () => {
    expect(defaultProfileId('wsl', FULL)).toBe('wsl')
  })

  it('falls back to powershell for wsl projects without a distro', () => {
    expect(defaultProfileId('wsl', NO_WSL)).toBe('powershell')
  })
})

describe('resolveSpawn', () => {
  it('spawns powershell in the project dir', async () => {
    expect(await resolveSpawn(NATIVE, 'powershell', FULL)).toEqual({
      file: 'powershell.exe',
      args: ['-NoLogo'],
      cwd: 'C:\\Projects\\demo'
    })
  })

  it('spawns cmd in the project dir', async () => {
    expect(await resolveSpawn(NATIVE, 'cmd', FULL)).toEqual({
      file: 'cmd.exe',
      args: [],
      cwd: 'C:\\Projects\\demo'
    })
  })

  it('spawns git bash interactive login shell', async () => {
    expect(await resolveSpawn(NATIVE, 'gitbash', FULL)).toEqual({
      file: 'C:\\Program Files\\Git\\bin\\bash.exe',
      args: ['-i', '-l'],
      cwd: 'C:\\Projects\\demo'
    })
  })

  it('rejects git bash when not found', async () => {
    expect(await resolveSpawn(NATIVE, 'gitbash', NO_GITBASH)).toBeNull()
  })

  it('converts cwd for wsl profile', async () => {
    const result = await resolveSpawn(NATIVE, 'wsl', FULL, async () => '/mnt/c/Projects/demo')
    expect(result).toEqual({ file: 'wsl.exe', args: ['-d', 'Ubuntu', '--cd', '/mnt/c/Projects/demo'], cwd: 'C:\\Projects\\demo' })
  })

  it('spawns wsl without --cd when conversion fails', async () => {
    const result = await resolveSpawn(WSL, 'wsl', FULL, async () => null)
    expect(result).toEqual({ file: 'wsl.exe', args: ['-d', 'Ubuntu'], cwd: WSL.dir })
  })

  it('rejects wsl profile without a distro', async () => {
    expect(await resolveSpawn(NATIVE, 'wsl', NO_WSL, async () => '/tmp')).toBeNull()
  })
})

describe('findGitBash', () => {
  it('returns first existing candidate', () => {
    expect(findGitBash(['C:\\definitely\\missing\\bash.exe', import.meta.filename])).toBe(import.meta.filename)
  })

  it('returns null when nothing exists', () => {
    expect(findGitBash(['C:\\definitely\\missing\\bash.exe'])).toBeNull()
  })
})
