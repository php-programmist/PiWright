import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }))
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  spawn: spawnMock
}))

import { DaemonClient } from '../src/main/daemon/client'

function missingChannel(): string {
  if (process.platform === 'win32') return `\\\\.\\pipe\\piwright-daemon-missing-${randomUUID()}`
  return join(tmpdir(), `piwright-daemon-missing-${randomUUID()}`)
}

describe('DaemonClient node host (headless web mode)', () => {
  it('forks the daemon directly: execPath + args, detached, no ELECTRON_RUN_AS_NODE override', async () => {
    spawnMock.mockReturnValue({ on: vi.fn(), unref: vi.fn() })
    const dir = mkdtempSync(join(tmpdir(), 'piwright-headless-'))
    const daemonJs = join(dir, 'daemon.js')
    writeFileSync(daemonJs, '// stub')
    const client = new DaemonClient({
      userDataDir: dir,
      appVersion: '1.2.3',
      channelPath: missingChannel(),
      daemonJsPath: daemonJs,
      connectTimeoutMs: 50,
      connectRetryMs: 10,
      connectRetryTotalMs: 60,
      nodeHost: true
    })
    await expect(client.connect()).rejects.toThrow()
    expect(spawnMock).toHaveBeenCalledTimes(1)
    const [execPath, argv, opts] = spawnMock.mock.calls[0] as [string, string[], { detached: boolean; stdio: string; env?: Record<string, string> }]
    expect(execPath).toBe(process.execPath)
    expect(argv).toEqual([daemonJs, '--user-data', dir, '--app-version', '1.2.3'])
    expect(opts.detached).toBe(true)
    expect(opts.stdio).toBe('ignore')
    // env не переопределяется: ELECTRON_RUN_AS_NODE уже в окружении node-хоста (или хост — настоящий node).
    expect(opts.env).toBeUndefined()
    rmSync(dir, { recursive: true, force: true })
  })
})
