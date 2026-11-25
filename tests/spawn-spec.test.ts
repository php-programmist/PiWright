import { describe, expect, it } from 'vitest'
import { buildNativeSpec } from '../src/main/pi/backends/native'
import { buildWslSpec } from '../src/main/pi/backends/wsl'
import { buildSshSpec } from '../src/main/pi/backends/ssh'
import { sessionFileFromArgs } from '../src/main/pi/pi-args'
import { spawnFromSpec } from '../src/main/pi/backends/spawn'
import type { PiSpawnSpec, PiSpawnRequest } from '../src/main/pi/backends/types'
import type { SshServerEntry } from '../src/shared/ipc-contracts'

const REQ: PiSpawnRequest = { cwd: 'C:\\proj', args: ['--mode', 'rpc'] }

describe('spawn specs', () => {
  it('native spec prepends the pi directory to PATH', () => {
    const spec = buildNativeSpec('C:\\tools\\pi.cmd', REQ)
    expect(spec).toMatchObject({ mode: 'native', piPath: 'C:\\tools\\pi.cmd', args: ['--mode', 'rpc'], cwd: 'C:\\proj' })
    expect(spec.env?.['PATH']?.indexOf('C:\\tools;')).toBe(0)
    expect(spec.env?.['PATH']).toContain(process.env['PATH'] ?? '')
  })

  it('wsl spec converts a UNC cwd without probes and keeps the original cwd', async () => {
    const spec = await buildWslSpec('Ubuntu', '/home/u/.local/bin/pi', {
      cwd: '\\\\wsl.localhost\\Ubuntu\\home\\u\\proj',
      args: ['--mode', 'rpc']
    })
    expect(spec.mode).toBe('wsl')
    expect(spec.wsl).toEqual({ distro: 'Ubuntu', cwd: '/home/u/proj' })
    expect(spec.cwd).toBe('\\\\wsl.localhost\\Ubuntu\\home\\u\\proj')
  })

  it('ssh spec carries the server and the secret in memory only', () => {
    const server: SshServerEntry = { id: 'srv1', name: 'box', host: 'example.com', port: 22, user: 'u', auth: 'password' }
    const spec = buildSshSpec(server, { password: 'secret' }, '/usr/local/bin/pi', REQ)
    expect(spec.mode).toBe('ssh')
    expect(spec.ssh).toEqual({ server, secret: { password: 'secret' } })
    expect(JSON.stringify(spec)).not.toContain('settings.json')
  })

  it('extracts the session file from args', () => {
    expect(sessionFileFromArgs(['--mode', 'rpc', '--session', 'C:\\s.json'])).toBe('C:\\s.json')
    expect(sessionFileFromArgs(['--mode', 'rpc'])).toBeNull()
    expect(sessionFileFromArgs(['--mode', 'rpc', '--session'])).toBeNull()
    expect(sessionFileFromArgs(['--mode', 'rpc', '--session', ''])).toBeNull()
  })
})

describe('spawnFromSpec dispatch', () => {
  it('rejects an ssh spec without an ssh service', async () => {
    const spec: PiSpawnSpec = { mode: 'ssh', piPath: 'pi', args: [], cwd: '/x', env: null }
    await expect(spawnFromSpec(spec)).rejects.toThrow()
  })
})
