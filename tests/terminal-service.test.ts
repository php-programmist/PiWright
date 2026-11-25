import { describe, expect, it } from 'vitest'
import { TerminalService } from '../src/main/terminal/terminal-service'
import type { PtySpawner } from '../src/main/terminal/terminal-service'
import type { ProfileAvailability } from '../src/main/terminal/profiles'
import type { IPty } from 'node-pty'
import type { ProjectEntry } from '../src/shared/ipc-contracts'

const AVAIL: ProfileAvailability = { gitBashPath: 'C:\\Git\\bin\\bash.exe', wslDistro: 'Ubuntu', sshServer: null }
const NATIVE: ProjectEntry = { kind: 'native', dir: 'C:\\Projects\\demo' }

class FakePty {
  written: string[] = []
  resized: Array<[number, number]> = []
  killed = false
  private dataCb: ((data: string) => void) | null = null
  private exitCb: ((event: { exitCode: number }) => void) | null = null

  write(data: string): void {
    this.written.push(data)
  }

  resize(cols: number, rows: number): void {
    this.resized.push([cols, rows])
  }

  kill(): void {
    this.killed = true
    this.exitCb?.({ exitCode: 0 })
  }

  onData(cb: (data: string) => void): void {
    this.dataCb = cb
  }

  onExit(cb: (event: { exitCode: number }) => void): void {
    this.exitCb = cb
  }

  emitData(data: string): void {
    this.dataCb?.(data)
  }

  emitExit(code: number): void {
    this.exitCb?.({ exitCode: code })
  }
}

function harness() {
  const created: Array<{ file: string; args: string[]; cwd: string; pty: FakePty }> = []
  const data: Array<{ id: string; data: string }> = []
  const exits: Array<{ id: string; code: number }> = []
  const spawner: PtySpawner = (file, args, cwd) => {
    const pty = new FakePty()
    created.push({ file, args, cwd, pty })
    return pty as unknown as IPty
  }
  const service = new TerminalService(
    {
      onData: (id, d) => data.push({ id, data: d }),
      onExit: (id, code) => exits.push({ id, code })
    },
    spawner
  )
  return { service, created, data, exits }
}

describe('TerminalService', () => {
  it('profiles follow availability and project kind', () => {
    const { service } = harness()
    const result = service.profiles(NATIVE, AVAIL)
    expect(result.defaultProfileId).toBe('powershell')
    expect(result.profiles.map((p) => p.id)).toEqual(['powershell', 'cmd', 'gitbash', 'wsl'])
  })

  it('creates a terminal with default profile and pipes data', async () => {
    const { service, created, data } = harness()
    const info = await service.create(NATIVE, null, AVAIL)
    expect(info).not.toBeNull()
    expect(info?.profileId).toBe('powershell')
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ file: 'powershell.exe', args: ['-NoLogo'], cwd: NATIVE.dir })
    created[0].pty.emitData('hello')
    expect(data).toEqual([{ id: info?.id, data: 'hello' }])
  })

  it('creates wsl terminal for wsl project by default', async () => {
    const { service, created } = harness()
    const info = await service.create({ kind: 'wsl', dir: '\\\\wsl.localhost\\Ubuntu\\home\\u\\demo' }, null, AVAIL)
    expect(info?.profileId).toBe('wsl')
    expect(created[0].file).toBe('wsl.exe')
    expect(created[0].args).toEqual(['-d', 'Ubuntu', '--cd', '/home/u/demo'])
  })

  it('returns null for unavailable profile', async () => {
    const { service } = harness()
    expect(await service.create(NATIVE, 'gitbash', { gitBashPath: null, wslDistro: null, sshServer: null })).toBeNull()
  })

  it('writes input and resizes the pty', async () => {
    const { service, created } = harness()
    const info = await service.create(NATIVE, null, AVAIL)
    service.input(info!.id, 'ls\r')
    service.resize(info!.id, 120.7, 40.2)
    expect(created[0].pty.written).toEqual(['ls\r'])
    expect(created[0].pty.resized).toEqual([[120, 40]])
  })

  it('ignores unknown ids', () => {
    const { service } = harness()
    expect(() => service.input('nope', 'x')).not.toThrow()
    expect(() => service.resize('nope', 10, 10)).not.toThrow()
    expect(() => service.close('nope')).not.toThrow()
  })

  it('close kills the pty and detaches it', async () => {
    const { service, created } = harness()
    const info = await service.create(NATIVE, null, AVAIL)
    service.close(info!.id)
    expect(created[0].pty.killed).toBe(true)
    service.input(info!.id, 'more')
    expect(created[0].pty.written).toEqual([])
  })

  it('exit event fires once and terminal is removed', async () => {
    const { service, created, exits } = harness()
    const info = await service.create(NATIVE, null, AVAIL)
    created[0].pty.emitExit(3)
    expect(exits).toEqual([{ id: info?.id, code: 3 }])
    service.input(info!.id, 'x')
    expect(created[0].pty.written).toEqual([])
  })

  it('disposeAll kills every terminal', async () => {
    const { service, created } = harness()
    await service.create(NATIVE, 'powershell', AVAIL)
    await service.create(NATIVE, 'gitbash', AVAIL)
    service.disposeAll()
    expect(created.every((c) => c.pty.killed)).toBe(true)
  })
})
