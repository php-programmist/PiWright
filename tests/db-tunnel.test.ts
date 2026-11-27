/** SshService.forwardOut РїСЂРѕС‚РёРІ in-process ssh2-СЃРµСЂРІРµСЂР°: direct-tcpip РєР°РЅР°Р» РґРѕ Р»РѕРєР°Р»СЊРЅРѕРіРѕ
 *  echo-TCP-СЃРµСЂРІРµСЂР°, РґРІСѓСЃС‚РѕСЂРѕРЅРЅРёР№ РѕР±РјРµРЅ, Р·Р°РєСЂС‹С‚РёРµ SSH-РєР»РёРµРЅС‚Р° Р·Р°РєСЂС‹РІР°РµС‚ РїРѕС‚РѕРє. */
import { generateKeyPairSync } from 'node:crypto'
import { createConnection, createServer, type Server as TcpServer, type Socket as TcpSocket } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Server as SshServer } from 'ssh2'
import { SshService } from '../src/main/ssh/ssh-service'
import { SshKnownHosts } from '../src/main/ssh/known-hosts'
import { SshSecretsService } from '../src/main/ssh/secrets'
import type { SshServerEntry } from '../src/shared/ipc-contracts'

const USER = 'tester'
const PASSWORD = 'secret-pass'

const dirs: string[] = []

class TunnelSshServer {
  readonly server: SshServer

  constructor(hostKeyPem: string) {
    this.server = new SshServer({ hostKeys: [hostKeyPem] }, (client) => {
      client.on('error', () => {})
      client.on('authentication', (ctx) => {
        if (ctx.method === 'password' && ctx.username === USER && ctx.password === PASSWORD) {
          ctx.accept()
          return
        }
        ctx.reject()
      })
      client.on('ready', () => {
        client.on('tcpip', (accept, _reject, info) => {
          const stream = accept()
          const upstream = createConnection({ host: info.destIP, port: info.destPort }, () => {
            stream.pipe(upstream)
            upstream.pipe(stream)
          })
          upstream.on('error', () => stream.destroy())
          stream.on('close', () => upstream.destroy())
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
}

describe('SshService.forwardOut (in-process ssh2 server)', () => {
  let sshServer: TunnelSshServer
  let sshPort: number
  let echo: TcpServer
  let echoPort: number
  let ssh: SshService
  let entry: SshServerEntry

  beforeAll(async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    sshServer = new TunnelSshServer(privateKey.export({ type: 'pkcs1', format: 'pem' }).toString())
    sshPort = await sshServer.listen()
    echo = createServer((socket: TcpSocket) => {
      socket.pipe(socket)
    })
    echoPort = await new Promise((resolve) => {
      echo.listen(0, '127.0.0.1', () => {
        const addr = echo.address()
        resolve(typeof addr === 'object' && addr !== null ? addr.port : 0)
      })
    })
    const dir = mkdtempSync(join(tmpdir(), 'piwright-db-tunnel-'))
    dirs.push(dir)
    const secrets = new SshSecretsService(
      join(dir, 'ssh-secrets.json'),
      (value) => Buffer.from(value, 'utf8'),
      (buffer) => buffer.toString('utf8')
    )
    secrets.set('srv-1', { password: PASSWORD })
    ssh = new SshService(secrets, new SshKnownHosts(join(dir, 'ssh-known-hosts.json')))
    entry = { id: 'srv-1', name: 'test', host: '127.0.0.1', port: sshPort, user: USER, auth: 'password' }
  })

  afterAll(() => {
    ssh.closeAll()
    sshServer.close()
    echo.close()
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  })

  it('pipes data through direct-tcpip to the target host:port', async () => {
    const stream = await ssh.forwardOut(entry, '127.0.0.1', echoPort)
    const received = await new Promise<string>((resolve, reject) => {
      let text = ''
      stream.on('data', (chunk: Buffer) => {
        text += chunk.toString('utf8')
        if (text.includes('ping-payload')) resolve(text)
      })
      stream.on('error', reject)
      stream.write('ping-payload')
    })
    expect(received).toContain('ping-payload')
    stream.destroy()
  })

  it('explicit secret overrides stored one', async () => {
    const stream = await ssh.forwardOut(entry, '127.0.0.1', echoPort, { password: PASSWORD })
    const ok = await new Promise<boolean>((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => {
        if (chunk.toString('utf8').includes('ok')) resolve(true)
      })
      stream.on('error', reject)
      stream.write('ok')
    })
    expect(ok).toBe(true)
    stream.destroy()
  })

  it('closing the ssh pool kills the tunnel stream', async () => {
    // РЎРІРµР¶РёР№ СЃРµСЂРІРёСЃ: РїСЂРµРґС‹РґСѓС‰РёРµ С‚РµСЃС‚С‹ РїРµСЂРµРёСЃРїРѕР»СЊР·РѕРІР°Р»Рё РїСѓР» Рё Р·Р°РєСЂС‹РІР°Р»Рё РєР°РЅР°Р»С‹ РІСЂСѓС‡РЅСѓСЋ.
    const dir = mkdtempSync(join(tmpdir(), 'piwright-db-tunnel-close-'))
    dirs.push(dir)
    const secrets = new SshSecretsService(
      join(dir, 'ssh-secrets.json'),
      (value) => Buffer.from(value, 'utf8'),
      (buffer) => buffer.toString('utf8')
    )
    secrets.set('srv-1', { password: PASSWORD })
    const fresh = new SshService(secrets, new SshKnownHosts(join(dir, 'ssh-known-hosts.json')))
    const stream = await fresh.forwardOut(entry, '127.0.0.1', echoPort)
    stream.on('error', () => {})
    stream.on('data', () => {})
    await new Promise((resolve) => setTimeout(resolve, 50))
    fresh.closeAll()
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('stream not closed after closeAll')), 3000)
      stream.on('close', () => {
        clearTimeout(timer)
        resolve()
      })
      stream.on('error', () => {})
    })
  })

  it('bad credentials reject forwardOut (РґСЂСѓРіРѕР№ user вЂ” РґСЂСѓРіРѕР№ РєР»СЋС‡ РїСѓР»Р°, СЂРµР°Р»СЊРЅР°СЏ Р°СѓС‚РµРЅС‚РёС„РёРєР°С†РёСЏ)', async () => {
    const bad: SshServerEntry = { ...entry, user: 'wrong-user' }
    await expect(ssh.forwardOut(bad, '127.0.0.1', echoPort)).rejects.toThrow()
  })
})
