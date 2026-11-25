/** SshService против in-process ssh2-сервера: exec (env/cwd/login), spawn-канал как PiChildProcess,
 *  host key accept-new/подмена, секреты, SshProjectFs (SFTP: read/write/rename/mkdir/rm/readdir/lock). */
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Server as SshServer, type ServerChannel } from 'ssh2'
import { createRequire } from 'node:module'
import { SshService } from '../src/main/ssh/ssh-service'
import { SshSecretsService } from '../src/main/ssh/secrets'
import { SshKnownHosts } from '../src/main/ssh/known-hosts'
import { SshProjectFs } from '../src/main/fs/project-fs'
import { buildRemoteCommand, loginShellCommand } from '../src/main/ssh/remote-command'
import type { SshServerEntry } from '../src/shared/ipc-contracts'

// Константы SFTP-протокола живут в lib/protocol/sftp (в корневом экспорте ssh2 их нет с 1.x).
const { OPEN_MODE, STATUS_CODE } = createRequire(import.meta.url)('ssh2/lib/protocol/sftp') as {
  OPEN_MODE: Record<string, number>
  STATUS_CODE: Record<string, number>
}

const USER = 'tester'
const PASSWORD = 'secret-pass'
const FAKE_HOME = '/home/tester'

interface FakeFile {
  data: Buffer
  mtime: number
}

/** In-memory SSH-сервер: password-auth, canned exec, SFTP (open/read/write/dir/stat/rename/remove). */
class FakeSshServer {
  readonly server: SshServer
  readonly execCommands: string[] = []
  readonly files = new Map<string, FakeFile>()
  readonly dirs = new Set<string>(['/', '/home', FAKE_HOME])
  /** Обработчик долгоживущего exec (spawn pi): тест ставит свой. */
  spawnHandler: ((command: string, stream: ServerChannel) => void) | null = null
  hostKeyPem: string

  constructor(hostKeyPem: string) {
    this.hostKeyPem = hostKeyPem
    this.server = new SshServer({ hostKeys: [hostKeyPem] }, (client) => {
      client.on('error', () => {}) // обрывы от клиента (отклонённый host key) — не падаем
      client.on('authentication', (ctx) => {
        if (ctx.method === 'password' && ctx.username === USER && ctx.password === PASSWORD) {
          ctx.accept()
          return
        }
        ctx.reject()
      })
      client.on('ready', () => {
        client.on('session', (accept) => {
          const session = accept()
          session.on('exec', (accept, _reject, info) => {
            this.execCommands.push(info.command)
            const stream = accept()
            if (this.spawnHandler !== null && info.command.includes('pi --mode rpc')) {
              this.spawnHandler(info.command, stream)
              return
            }
            this.handleExec(info.command, stream)
          })
          session.on('sftp', (accept) => {
            this.handleSftp(accept())
          })
        })
      })
    })
  }

  listen(): Promise<number> {
    return new Promise((resolve) => {
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address()
        resolve(typeof addr === 'object' && addr !== null ? addr.port : 0)
      })
    })
  }

  close(): void {
    this.server.close()
  }

  private handleExec(command: string, stream: ServerChannel): void {
    if (command.includes('echo "$HOME"')) {
      stream.write(`${FAKE_HOME}\n`)
      stream.exit(0)
      stream.close()
      return
    }
    if (command.includes('command -v pi')) {
      stream.write('/usr/local/bin/pi\n')
      stream.exit(0)
      stream.close()
      return
    }
    if (command.startsWith('cat ')) {
      const path = command.slice(4).replace(/^'|'$/g, '')
      const file = this.files.get(path)
      if (file === undefined) {
        stream.stderr.write(`cat: ${path}: No such file\n`)
        stream.exit(1)
      } else {
        stream.write(file.data)
        stream.exit(0)
      }
      stream.close()
      return
    }
    stream.write(`OK:${command}\n`)
    stream.exit(0)
    stream.close()
  }

  private attrs(path: string): { mode: number; size: number; mtime: number } | null {
    if (this.dirs.has(path)) return { mode: 0o040755, size: 0, mtime: 1 }
    const file = this.files.get(path)
    if (file !== undefined) return { mode: 0o100644, size: file.data.length, mtime: file.mtime }
    return null
  }

  private handleSftp(sftp: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    on(event: string, listener: (...args: any[]) => void): unknown
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handle(reqid: number, handle: any): void
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    status(reqid: number, code: any): void
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data(reqid: number, buffer: any): void
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    attrs(reqid: number, attrs: any): void
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    name(reqid: number, items: any): void
  }): void {
    const handles = new Map<number, { path: string; read: boolean; write: boolean }>()
    let nextHandle = 1
    const handleNum = (handle: Buffer): number => (Buffer.isBuffer(handle) && handle.length === 4 ? handle.readUInt32BE(0) : -1)
    const ok = (reqid: number): void => sftp.status(reqid, STATUS_CODE.OK)
    const fail = (reqid: number): void => sftp.status(reqid, STATUS_CODE.FAILURE)
    const noSuch = (reqid: number): void => sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE)

    sftp.on('OPEN', (reqid: number, filename: string, flags: number) => {
      const existing = this.files.get(filename)
      const isWrite = (flags & OPEN_MODE.WRITE) !== 0
      const isExcl = (flags & OPEN_MODE.EXCL) !== 0
      if (isExcl && existing !== undefined) {
        fail(reqid)
        return
      }
      if (!isWrite && existing === undefined) {
        noSuch(reqid)
        return
      }
      const handle = Buffer.alloc(4)
      handle.writeUInt32BE(nextHandle, 0)
      handles.set(nextHandle, { path: filename, read: !isWrite, write: isWrite })
      nextHandle += 1
      sftp.handle(reqid, handle)
    })
    sftp.on('READ', (reqid: number, handle: Buffer, _offset: number, length: number) => {
      const state = handles.get(handleNum(handle))
      const file = state !== undefined ? this.files.get(state.path) : undefined
      if (state === undefined || file === undefined || !state.read) {
        fail(reqid)
        return
      }
      const f = file as FakeFile & { sent?: boolean }
      if (f.sent === true) {
        sftp.status(reqid, STATUS_CODE.EOF)
        return
      }
      f.sent = true
      sftp.data(reqid, f.data.subarray(0, Math.min(length, f.data.length)))
    })
    sftp.on('WRITE', (reqid: number, handle: Buffer, offset: number, chunk: Buffer) => {
      const state = handles.get(handleNum(handle))
      if (state === undefined || !state.write) {
        fail(reqid)
        return
      }
      const existing = this.files.get(state.path) ?? { data: Buffer.alloc(0), mtime: 0 }
      const data = offset === 0 ? Buffer.from(chunk) : Buffer.concat([existing.data.subarray(0, offset), Buffer.from(chunk)])
      this.files.set(state.path, { data, mtime: Date.now() })
      ok(reqid)
    })
    sftp.on('CLOSE', (reqid: number) => ok(reqid))
    sftp.on('OPENDIR', (reqid: number, path: string) => {
      if (!this.dirs.has(path)) {
        noSuch(reqid)
        return
      }
      const handle = Buffer.alloc(4)
      handle.writeUInt32BE(nextHandle, 0)
      handles.set(nextHandle, { path, read: true, write: false })
      nextHandle += 1
      sftp.handle(reqid, handle)
    })
    sftp.on('READDIR', (reqid: number, handle: Buffer) => {
      const state = handles.get(handleNum(handle))
      if (state === undefined) {
        fail(reqid)
        return
      }
      const dir = state.path
      if ((state as { sent?: boolean }).sent === true) {
        sftp.status(reqid, STATUS_CODE.EOF)
        return
      }
      ;(state as { sent?: boolean }).sent = true
      const names: string[] = []
      for (const d of this.dirs) {
        const parent = d === '/' ? '/' : d.slice(0, d.lastIndexOf('/')) || '/'
        if (parent === dir && d !== dir) names.push(d.slice(d.lastIndexOf('/') + 1))
      }
      for (const f of this.files.keys()) {
        const parent = f.slice(0, f.lastIndexOf('/')) || '/'
        if (parent === dir) names.push(f.slice(f.lastIndexOf('/') + 1))
      }
      sftp.name(
        reqid,
        names.map((filename) => ({
          filename,
          longname: filename,
          attrs: this.attrs(`${dir === '/' ? '' : dir}/${filename}`) ?? { mode: 0o100644, size: 0, mtime: 1 }
        }))
      )
    })
    sftp.on('STAT', (reqid: number, path: string) => {
      const attrs = this.attrs(path)
      if (attrs === null) {
        noSuch(reqid)
        return
      }
      sftp.attrs(reqid, attrs)
    })
    sftp.on('MKDIR', (reqid: number, path: string) => {
      this.dirs.add(path)
      ok(reqid)
    })
    sftp.on('REMOVE', (reqid: number, path: string) => {
      if (this.files.delete(path)) ok(reqid)
      else noSuch(reqid)
    })
    sftp.on('RMDIR', (reqid: number, path: string) => {
      if (this.dirs.delete(path)) ok(reqid)
      else noSuch(reqid)
    })
    sftp.on('RENAME', (reqid: number, from: string, to: string) => {
      const file = this.files.get(from)
      if (file === undefined) {
        noSuch(reqid)
        return
      }
      this.files.delete(from)
      this.files.set(to, file)
      ok(reqid)
    })
  }
}

function makeEntry(port: number, host = '127.0.0.1'): SshServerEntry {
  return { id: 'srv-1', name: 'test', host, port, user: USER, auth: 'password' }
}

function makeService(dir: string): { ssh: SshService; knownHosts: SshKnownHosts } {
  const secrets = new SshSecretsService(
    join(dir, 'ssh-secrets.json'),
    (value) => Buffer.from(value, 'utf8'),
    (buffer) => buffer.toString('utf8')
  )
  const knownHosts = new SshKnownHosts(join(dir, 'ssh-known-hosts.json'))
  return { ssh: new SshService(secrets, knownHosts), knownHosts }
}

// ssh2-сервер принимает RSA PKCS#1 (ed25519 PKCS#8 он не парсит).
const { privateKey: hostKeyPem } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const pem = hostKeyPem.export({ type: 'pkcs1', format: 'pem' }).toString()

const dirs: string[] = []
let workDir = ''
let server: FakeSshServer
let port = 0
let ssh: SshService
let knownHosts: SshKnownHosts

beforeAll(async () => {
  server = new FakeSshServer(pem)
  port = await server.listen()
})

afterAll(() => {
  server.close()
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'piwright-ssh-'))
  dirs.push(workDir)
  const made = makeService(workDir)
  ssh = made.ssh
  knownHosts = made.knownHosts
  // Сервер принимает пароль из хранилища секретов — как после сохранения в UI.
  ssh.setSecret('srv-1', { password: PASSWORD })
})

describe('remote-command builder', () => {
  it('builds cd + env prefix chain', () => {
    expect(buildRemoteCommand('git status', { cwd: '/tmp/p', env: { GIT_DIR: '/x' } })).toBe(
      "cd '/tmp/p' && GIT_DIR='/x' git status"
    )
  })

  it('login wrapper quotes the inner command', () => {
    expect(loginShellCommand("echo 'a'")).toBe("bash -lic 'echo '\\''a'\\'''")
  })
})

describe('SshService.exec', () => {
  it('runs a command and returns stdout', async () => {
    const result = await ssh.exec(makeEntry(port), 'echo hello')
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('OK:echo hello')
  })

  it('applies cwd via cd and env via KEY=value prefix', async () => {
    await ssh.exec(makeEntry(port), 'git status', { cwd: '/tmp/proj', env: { GIT_ASKPASS: '/bin/true' } })
    const last = server.execCommands.at(-1) ?? ''
    expect(last).toContain("cd '/tmp/proj'")
    expect(last).toContain("GIT_ASKPASS='/bin/true'")
    expect(last).toContain('git status')
  })

  it('login wrapper wraps the command in bash -lic', async () => {
    await ssh.exec(makeEntry(port), 'pi --version', { login: true })
    const last = server.execCommands.at(-1) ?? ''
    expect(last.startsWith('bash -lic ')).toBe(true)
  })

  it('resolves $HOME via login shell', async () => {
    const home = await ssh.homeDir(makeEntry(port))
    expect(home).toBe(FAKE_HOME)
  })

  it('rejects a wrong password with an error', async () => {
    // Свежий сервис в чистом каталоге: секрета нет → пустой пароль → сервер отклоняет аутентификацию.
    const fresh = makeService(mkdtempSync(join(tmpdir(), 'piwright-ssh-empty-')))
    const entry = { ...makeEntry(port) }
    await expect(fresh.ssh.exec(entry, 'echo hi')).rejects.toThrow()
    fresh.ssh.closeAll()
  })

  it('rejects a changed host key and remembers new keys', async () => {
    const entry = makeEntry(port)
    await ssh.exec(entry, 'echo hello')
    expect(knownHosts.fingerprint(entry.host, entry.port)).not.toBeNull()
    // Подменённый ключ: второй сервер на другом порту, но known-hosts заранее знает
    // ЧУЖОЙ отпечаток для этого host:port → accept-new не срабатывает, подмена ловится.
    const otherKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()
    const other = new FakeSshServer(otherKey)
    const otherPort = await other.listen()
    try {
      knownHosts.remember('127.0.0.1', otherPort, 'sha256:stale-fingerprint')
      const shared = makeService(workDir)
      await expect(shared.ssh.exec(makeEntry(otherPort), 'echo hello')).rejects.toThrow(/changed/)
      shared.ssh.closeAll()
    } finally {
      other.close()
    }
  })
})

describe('SshService.spawn (PiChildProcess)', () => {
  it('streams stdout lines and reports close with exit code', async () => {
    server.spawnHandler = (_command, stream) => {
      stream.write('{"type":"response","id":"1"}\n')
      stream.write('{"type":"agent_start"}\n')
      stream.on('data', () => {})
      setTimeout(() => {
        stream.exit(0)
        stream.close()
      }, 120)
    }
    const child = await ssh.spawn(makeEntry(port), 'pi --mode rpc', { cwd: '/tmp/p' })
    const lines: string[] = []
    let closed: number | null | undefined
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => lines.push(...chunk.split('\n').filter((l) => l.length > 0)))
    child.on('close', (code) => {
      closed = code
    })
    child.stdin?.write('{"id":"1"}\n')
    await new Promise((resolve) => setTimeout(resolve, 60))
    child.stdin?.end()
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(lines).toContain('{"type":"response","id":"1"}')
    expect(closed).toBe(0)
    server.spawnHandler = null
  })
})

describe('SshProjectFs over SFTP', () => {
  const entry = (): SshServerEntry => makeEntry(port)
  const pfs = (): SshProjectFs => new SshProjectFs(() => ssh.sftp(entry()))

  it('writes, reads and stats a file', async () => {
    const fs = pfs()
    await fs.writeFile('/home/tester/a.txt', 'hello')
    expect(await fs.readText('/home/tester/a.txt')).toBe('hello')
    const st = await fs.stat('/home/tester/a.txt')
    expect(st?.isDir).toBe(false)
    expect(st?.size).toBe(5)
    expect(await fs.exists('/home/tester/a.txt')).toBe(true)
    expect(await fs.exists('/home/tester/missing.txt')).toBe(false)
  })

  it('lists directories', async () => {
    const fs = pfs()
    server.dirs.add('/home/tester/proj')
    await fs.writeFile('/home/tester/proj/x.txt', 'x')
    const items = await fs.readdir('/home/tester')
    expect(items.some((i) => i.name === 'proj' && i.isDir)).toBe(true)
    const inner = await fs.readdir('/home/tester/proj')
    expect(inner.map((i) => i.name)).toContain('x.txt')
  })

  it('renames with overwrite and removes recursively', async () => {
    const fs = pfs()
    await fs.writeFile('/home/tester/r1.txt', 'one')
    await fs.writeFile('/home/tester/r2.txt', 'two')
    await fs.renameOverwrite('/home/tester/r1.txt', '/home/tester/r2.txt')
    expect(await fs.readText('/home/tester/r2.txt')).toBe('one')
    await fs.rm('/home/tester/r2.txt')
    expect(await fs.exists('/home/tester/r2.txt')).toBe(false)
    await expect(fs.rm('/home/tester/r2.txt')).rejects.toThrow(/ENOENT/)
  })

  it('mkdir recursive creates nested dirs; join/dirname are POSIX', async () => {
    const fs = pfs()
    await fs.mkdir('/home/tester/deep/nest', { recursive: true })
    expect(server.dirs.has('/home/tester/deep')).toBe(true)
    expect(server.dirs.has('/home/tester/deep/nest')).toBe(true)
    expect(fs.join('/a', 'b', 'c.txt')).toBe('/a/b/c.txt')
    expect(fs.dirname('/a/b/c.txt')).toBe('/a/b')
    expect(fs.basename('/a/b/c.txt')).toBe('c.txt')
  })

  it('createExclusive succeeds once then reports busy', async () => {
    const fs = pfs()
    expect(await fs.createExclusive('/home/tester/lock.lock', '1')).toBe(true)
    expect(await fs.createExclusive('/home/tester/lock.lock', '2')).toBe(false)
  })

  it('readHead returns the beginning of a file', async () => {
    const fs = pfs()
    await fs.writeFile('/home/tester/head.jsonl', '{"type":"session","cwd":"/p"}\nmore')
    const head = await fs.readHead('/home/tester/head.jsonl', 64)
    expect(head.split('\n')[0]).toBe('{"type":"session","cwd":"/p"}')
  })

  it('secrets round-trip through the store', async () => {
    ssh.setSecret('srv-1', { password: 'p@ss' })
    expect(ssh.hasPassword('srv-1')).toBe(true)
    expect(ssh.hasKeyPassphrase('srv-1')).toBe(false)
    ssh.setSecret('srv-1', { password: null })
    expect(ssh.hasPassword('srv-1')).toBe(false)
    ssh.setSecret('srv-2', { keyPassphrase: 'phrase' })
    expect(ssh.removedServerIds(new Set(['srv-1']))).toEqual(['srv-2'])
  })
})

describe('SshSecretsService persistence', () => {
  it('persists encrypted secrets to disk and reloads them', () => {
    const file = join(workDir, 'secrets.json')
    const enc = (v: string): Buffer => Buffer.from(`enc:${v}`, 'utf8')
    const dec = (b: Buffer): string => b.toString('utf8').replace(/^enc:/, '')
    const service = new SshSecretsService(file, enc, dec)
    service.set('a', { password: 'one' })
    service.set('b', { keyPassphrase: 'two' })
    expect(existsSync(file)).toBe(true)
    const raw = readFileSync(file, 'utf8')
    // Значение хранится base64(encrypt('one')) — открытый пароль в файл не попадает.
    expect(raw).toContain('ZW5jOm9uZQ==')
    expect(raw).not.toContain('"one"')
    const reloaded = new SshSecretsService(file, enc, dec)
    expect(reloaded.get('a')).toEqual({ password: 'one' })
    expect(reloaded.get('b')).toEqual({ keyPassphrase: 'two' })
    reloaded.remove('a')
    expect(new SshSecretsService(file, enc, dec).get('a')).toEqual({})
  })

  it('survives a corrupted file', () => {
    const file = join(workDir, 'broken.json')
    writeFileSync(file, '{not json', 'utf8')
    const service = new SshSecretsService(file, (v) => Buffer.from(v), (b) => b.toString())
    expect(service.get('x')).toEqual({})
  })
})
