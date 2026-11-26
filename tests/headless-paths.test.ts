import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { defaultUserData, parseArgs, readAppVersion } from '../src/main/headless/paths'

describe('headless paths', () => {
  it('parses --port/--user-data/--host with defaults', () => {
    const args = parseArgs([])
    expect(args.port).toBe(7691)
    expect(args.bindHost).toBe('127.0.0.1')
    expect(args.userData).toBe(defaultUserData())
    const custom = parseArgs(['--port', '8080', '--user-data', 'C:\\data', '--host', '0.0.0.0'])
    expect(custom.port).toBe(8080)
    expect(custom.bindHost).toBe('0.0.0.0')
    expect(custom.userData).toBe('C:\\data')
  })

  it('rejects invalid ports', () => {
    expect(() => parseArgs(['--port', '0'])).toThrow('Invalid --port')
    expect(() => parseArgs(['--port', '70000'])).toThrow('Invalid --port')
    expect(() => parseArgs(['--port', 'abc'])).toThrow('Invalid --port')
  })

  it('default userData matches Electron app.getPath on this platform', () => {
    const dir = defaultUserData()
    if (process.platform === 'win32') {
      expect(dir).toContain('piwright')
      expect(dir.toLowerCase()).toContain('appdata')
    } else if (process.platform === 'darwin') {
      expect(dir).toBe(join(process.env['HOME'] ?? '', 'Library', 'Application Support', 'piwright'))
    } else {
      expect(dir).toBe(join(process.env['XDG_CONFIG_HOME'] ?? join(process.env['HOME'] ?? '', '.config'), 'piwright'))
    }
  })

  it('reads app version from package.json relative to the module dir', () => {
    // tests/ → src/main/headless: ../.. от tests — корень репо с package.json (версия 0.5.0+).
    expect(readAppVersion(join(__dirname, '..', 'src', 'main', 'headless'))).toMatch(/^\d+\.\d+\.\d+/)
    // Глубоко несуществующий путь: ../.. не содержит package.json.
    expect(readAppVersion(join(tmpdir(), 'piwright-no-such-dir', 'a', 'b'))).toBe('0.0.0')
  })
})
