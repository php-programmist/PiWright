import { describe, expect, it } from 'vitest'
import {
  buildBashCommand,
  buildWslSpawnArgs,
  buildWslUncPath,
  quoteWindowsArg,
  shellQuote,
  stripWslUncPrefix
} from '../src/main/pi/backends/shell'

describe('shellQuote', () => {
  it('plain arg is single-quoted', () => {
    expect(shellQuote('hello')).toBe("'hello'")
  })

  it('single quotes are escaped for bash', () => {
    expect(shellQuote("it's")).toBe("'it'\\''s'")
  })

  it('dollar and backticks survive single quoting', () => {
    expect(shellQuote('echo $HOME `id`')).toBe("'echo $HOME `id`'")
  })
})

describe('buildBashCommand', () => {
  it('joins quoted executable and args', () => {
    expect(buildBashCommand('/usr/bin/pi', ['-p', 'fix it'])).toBe("'/usr/bin/pi' '-p' 'fix it'")
  })
})

describe('buildWslSpawnArgs', () => {
  it('targets wsl.exe with login interactive bash and cwd', () => {
    expect(buildWslSpawnArgs('Ubuntu', '/home/u/proj', "'pi' '-p' 'hi'")).toEqual([
      '-d',
      'Ubuntu',
      '--cd',
      '/home/u/proj',
      '--exec',
      'bash',
      '-lic',
      "'pi' '-p' 'hi'"
    ])
  })

  it('omits cd flag without cwd', () => {
    expect(buildWslSpawnArgs('Ubuntu', null, "'command' '-v' 'pi'")).toEqual([
      '-d',
      'Ubuntu',
      '--exec',
      'bash',
      '-lic',
      "'command' '-v' 'pi'"
    ])
  })
})

describe('stripWslUncPrefix', () => {
  it('unc path with forward slashes is stripped to wsl path', () => {
    expect(stripWslUncPrefix('//wsl.localhost/Ubuntu/home/akostin/projects/jb-pi')).toBe(
      '/home/akostin/projects/jb-pi'
    )
  })

  it('unc path with backslashes is stripped to wsl path', () => {
    expect(stripWslUncPrefix('\\\\wsl.localhost\\Ubuntu\\home\\u\\proj')).toBe('/home/u/proj')
  })

  it('legacy wsl dollar unc path is stripped', () => {
    expect(stripWslUncPrefix('\\\\wsl$\\Ubuntu\\home\\u\\proj')).toBe('/home/u/proj')
  })

  it('unc prefix match is case-insensitive', () => {
    expect(stripWslUncPrefix('//WSL.LOCALHOST/Ubuntu/home/u')).toBe('/home/u')
  })

  it('unc path with distro only becomes root', () => {
    expect(stripWslUncPrefix('//wsl.localhost/Ubuntu')).toBe('/')
  })

  it('native wsl path is not a unc path', () => {
    expect(stripWslUncPrefix('/home/u/proj')).toBeNull()
  })

  it('windows drive path is not a unc path', () => {
    expect(stripWslUncPrefix('C:\\Users\\u\\proj')).toBeNull()
  })
})

describe('buildWslUncPath', () => {
  it('joins distro and absolute wsl path with forward slashes', () => {
    expect(buildWslUncPath('Ubuntu', '/home/u/proj')).toBe('//wsl.localhost/Ubuntu/home/u/proj')
  })

  it('round-trips through stripWslUncPrefix', () => {
    const wsl = '/home/akostin/projects/jb-pi'
    expect(stripWslUncPrefix(buildWslUncPath('Ubuntu', wsl))).toBe(wsl)
  })

  it('of root round-trips to root', () => {
    expect(stripWslUncPrefix(buildWslUncPath('Ubuntu', '/'))).toBe('/')
  })
})

describe('quoteWindowsArg', () => {
  it('wraps arg in double quotes', () => {
    expect(quoteWindowsArg('C:\\Program Files\\pi.cmd')).toBe('"C:\\Program Files\\pi.cmd"')
  })
})
