import { describe, expect, it } from 'vitest'
import { buildNativeSpec, pathDirsFromEnv, posixPiCandidates, windowsPiCandidates } from '../src/main/pi/backends/native'
import { resolveWithinRootHost } from '../src/main/files/file-service'
import { HostProjectFs } from '../src/main/fs/project-fs'
import { availableProfiles, availablePosixShells, defaultProfileId } from '../src/main/terminal/profiles'
import { createSecretCodec, type SafeStorageLike } from '../src/main/secrets/secret-codec'
import { bundledSoundsDir, defaultSoundPaths } from '../src/main/sounds/defaults'
import type { ProfileAvailability } from '../src/main/terminal/profiles'
import type { ProjectEntry } from '../src/shared/ipc-contracts'

function withPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
  const original = process.platform
  Object.defineProperty(process, 'platform', { value: platform })
  try {
    return fn()
  } finally {
    Object.defineProperty(process, 'platform', { value: original })
  }
}

const AVAIL: ProfileAvailability = { gitBashPath: null, wslDistro: null, sshServer: null }
const NATIVE_PROJECT: ProjectEntry = { kind: 'native', dir: '/home/u/proj' }

describe('posix pi resolve', () => {
  it('posixPiCandidates points to ~/.local/bin and ~/.pi/agent/bin', () => {
    expect(posixPiCandidates('/home/u')).toEqual(['/home/u/.local/bin/pi', '/home/u/.pi/agent/bin/pi'])
  })

  it('windowsPiCandidates unchanged', () => {
    expect(windowsPiCandidates('C:\\Users\\u')).toEqual(['C:\\Users\\u\\.pi\\agent\\bin\\pi.cmd'])
  })

  it('pathDirsFromEnv splits on ":" when asked', () => {
    expect(pathDirsFromEnv('/usr/local/bin:/usr/bin:/bin', ':')).toEqual(['/usr/local/bin', '/usr/bin', '/bin'])
  })

  it('buildNativeSpec prepends binDir with the given separator', () => {
    const spec = buildNativeSpec('/usr/local/bin/pi', { cwd: '/home/u/proj', args: ['--mode', 'rpc'] }, ':')
    expect(spec.env?.['PATH']?.indexOf('/usr/local/bin:')).toBe(0)
    const pathKeys = Object.keys(spec.env ?? {}).filter((k) => k.toLowerCase() === 'path')
    expect(pathKeys).toEqual(['PATH'])
  })
})

describe('posix host paths', () => {
  it('resolveWithinRootHost joins posix on linux and rejects escapes', () => {
    expect(resolveWithinRootHost('/home/u/proj', 'src/a.ts', 'linux')).toBe('/home/u/proj/src/a.ts')
    expect(resolveWithinRootHost('/home/u/proj', '../outside', 'linux')).toBeNull()
    expect(resolveWithinRootHost('/home/u/proj', '/abs', 'linux')).toBeNull()
  })

  it('resolveWithinRootHost keeps win32 on windows', () => {
    expect(resolveWithinRootHost('C:\\proj', 'src\\a.ts', 'win32')).toBe('C:\\proj\\src\\a.ts')
  })

  it('HostProjectFs uses posix namespace on linux', () => {
    const pfs = new HostProjectFs('linux')
    expect(pfs.join('/home/u/proj', 'sub', 'file.txt')).toBe('/home/u/proj/sub/file.txt')
    expect(pfs.dirname('/home/u/proj/file.txt')).toBe('/home/u/proj')
    expect(pfs.basename('/home/u/proj/file.txt')).toBe('file.txt')
  })

  it('HostProjectFs keeps win32 namespace on windows', () => {
    const pfs = new HostProjectFs('win32')
    expect(pfs.join('C:\\proj', 'sub')).toBe('C:\\proj\\sub')
  })
})

describe('posix terminal profiles', () => {
  it('availablePosixShells is empty on windows', () => {
    expect(availablePosixShells('win32')).toEqual([])
  })

  it('linux profiles come from posix shells, no powershell/cmd/wsl', () => {
    const profiles = availableProfiles(NATIVE_PROJECT, AVAIL, false)
    expect(profiles.map((p) => p.id)).toEqual(availablePosixShells('linux').map((p) => p.id))
    expect(profiles.map((p) => p.id)).not.toContain('powershell')
  })

  it('defaultProfileId on linux is the first posix shell', () => {
    expect(defaultProfileId('native', AVAIL, false)).toBe('bash')
    expect(defaultProfileId('native', AVAIL, true)).toBe('powershell')
  })

  it('wsl profile requires windows', () => {
    const avail: ProfileAvailability = { ...AVAIL, wslDistro: 'Ubuntu' }
    expect(defaultProfileId('wsl', avail, false)).toBe('bash')
    expect(defaultProfileId('wsl', avail, true)).toBe('wsl')
  })
})

describe('secret codec', () => {
  const safeOk: SafeStorageLike = {
    isEncryptionAvailable: () => true,
    encryptString: (v) => Buffer.from(`enc(${v})`, 'utf8'),
    decryptString: (b) => {
      const s = b.toString('utf8')
      return s.startsWith('enc(') && s.endsWith(')') ? s.slice(4, -1) : 'BOOM'
    }
  }
  const safeUnavailable: SafeStorageLike = {
    isEncryptionAvailable: () => false,
    encryptString: () => {
      throw new Error('no keyring')
    },
    decryptString: () => {
      throw new Error('no keyring')
    }
  }

  it('uses safeStorage when available', () => {
    const codec = createSecretCodec(safeOk)
    expect(codec.decrypt(codec.encrypt('token'))).toBe('token')
  })

  it('falls back to prefixed base64 without keyring', () => {
    const codec = createSecretCodec(safeUnavailable)
    const encrypted = codec.encrypt('token')
    expect(encrypted.toString('utf8').startsWith('b64:')).toBe(true)
    expect(codec.decrypt(encrypted)).toBe('token')
  })

  it('decrypts fallback values even when keyring became available', () => {
    const codec = createSecretCodec(safeOk)
    const legacy = Buffer.from(`b64:${Buffer.from('token', 'utf8').toString('base64')}`, 'utf8')
    expect(codec.decrypt(legacy)).toBe('token')
  })
})

describe('default sounds', () => {
  it('windows keeps system wav paths', () => {
    withPlatform('win32', () => {
      expect(defaultSoundPaths(undefined)['await']).toBe('C:\\Windows\\Media\\Windows Notify.wav')
    })
  })

  it('linux points to bundled wav in resources', () => {
    withPlatform('linux', () => {
      const paths = defaultSoundPaths('/opt/piwright/resources')
      expect(paths['completion']).toBe('/opt/piwright/resources/sounds/notify-complete.wav')
      expect(paths['error']).toContain('notify-error.wav')
    })
  })

  it('without resourcesPath falls back to build/sounds from cwd', () => {
    withPlatform('linux', () => {
      expect(bundledSoundsDir(undefined)).toContain('build')
    })
  })
})
