import { describe, expect, it, afterEach } from 'vitest'
import { connect } from 'node:net'
import { request, type IncomingMessage } from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { RemoteWebServer } from '../src/main/remote/server'
import { RemoteAuth } from '../src/main/remote/auth'
import { attachRpcWs } from '../src/main/remote/rpc-ws'
import { RpcRouter } from '../src/main/ipc/router'
import { EventBroadcaster } from '../src/main/ipc/events'

const listener = { onOpen: () => {}, onText: () => {}, onClose: () => {} }

interface Running {
  port: number
  root: string
}

const running: Running[] = []

afterEach(() => {
  for (const r of running) rmSync(r.root, { recursive: true, force: true })
  running.length = 0
})

/** Поднимает сервер со статикой и логинится по PIN — возвращает порт и cookie. */
async function startWithAuth(staticRoot: string): Promise<{ port: number; cookie: string; server: RemoteWebServer }> {
  const rpc = attachRpcWs({ router: new RpcRouter(), events: new EventBroadcaster(), platform: 'linux', appVersion: 'test' })
  const server = new RemoteWebServer(0, new RemoteAuth('123456'), listener, () => 'en', rpc.upgrade, staticRoot)
  const started = await server.start()
  if (!started.ok) throw new Error(`start failed: ${started.error}`)
  const port = server.port
  const cookie = await new Promise<string>((resolvePromise, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/login', method: 'POST', headers: { 'Content-Length': 10 } }, (res: IncomingMessage) => {
      let body = ''
      res.on('data', (c) => (body += c))
      res.on('end', () => {
        const set = res.headers['set-cookie']?.find((c) => c.startsWith('pi_remote=')) ?? ''
        resolvePromise(set.split(';')[0])
      })
    })
    req.on('error', reject)
    req.end('pin=123456')
  })
  if (cookie.length === 0) throw new Error('login failed')
  return { port, cookie, server }
}

function get(port: number, path: string, cookie?: string): Promise<{ status: number | undefined; type: string | undefined; cache: string | undefined; body: string }> {
  return new Promise((resolvePromise, reject) => {
    const req = request(
      { host: '127.0.0.1', port, path, headers: cookie !== undefined ? { Cookie: cookie } : {} },
      (res: IncomingMessage) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () =>
          resolvePromise({ status: res.statusCode, type: res.headers['content-type'], cache: res.headers['cache-control'] as string | undefined, body })
        )
      }
    )
    req.on('error', reject)
    req.end()
  })
}

describe('RemoteWebServer static mode (headless web UI)', () => {
  it('serves index.html at / with no-store and assets with mime + caching', async () => {
    const root = mkdtempSync(join(tmpdir(), 'piwright-static-'))
    mkdirSync(join(root, 'assets'))
    writeFileSync(join(root, 'index.html'), '<!doctype html><html><body>PiWright</body></html>')
    writeFileSync(join(root, 'assets', 'app.js'), 'console.log(1)')
    running.push({ port: 0, root })
    const { port, cookie } = await startWithAuth(root)
    const index = await get(port, '/', cookie)
    expect(index.status).toBe(200)
    expect(index.type).toBe('text/html; charset=utf-8')
    expect(index.cache).toBe('no-store')
    expect(index.body).toContain('PiWright')
    const asset = await get(port, '/assets/app.js', cookie)
    expect(asset.status).toBe(200)
    expect(asset.type).toBe('text/javascript; charset=utf-8')
    expect(asset.cache).toBe('public, max-age=3600')
    expect(asset.body).toBe('console.log(1)')
  })

  it('falls back to index.html for extensionless SPA routes, 404 for unknown files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'piwright-static-'))
    writeFileSync(join(root, 'index.html'), '<html>spa</html>')
    running.push({ port: 0, root })
    const { port, cookie } = await startWithAuth(root)
    const spa = await get(port, '/some/client/route', cookie)
    expect(spa.status).toBe(200)
    expect(spa.body).toBe('<html>spa</html>')
    const missing = await get(port, '/no/such/file.js', cookie)
    expect(missing.status).toBe(404)
  })

  it('blocks path traversal outside the static root', async () => {
    const root = mkdtempSync(join(tmpdir(), 'piwright-static-'))
    writeFileSync(join(root, 'index.html'), '<html>spa</html>')
    writeFileSync(join(tmpdir(), `piwright-secret-${randomUUID()}.txt`), 'top secret')
    running.push({ port: 0, root })
    const { port, cookie } = await startWithAuth(root)
    const escape = await get(port, '/%2e%2e/%2e%2e/etc/passwd', cookie)
    expect(escape.status).toBe(404)
  })

  it('redirects unauthenticated requests to /login', async () => {
    const root = mkdtempSync(join(tmpdir(), 'piwright-static-'))
    writeFileSync(join(root, 'index.html'), '<html>spa</html>')
    running.push({ port: 0, root })
    const { port } = await startWithAuth(root)
    const anon = await get(port, '/')
    expect(anon.status).toBe(303)
  })

  it('accepts the /rpc upgrade and destroys other upgrades in static mode', async () => {
    const root = mkdtempSync(join(tmpdir(), 'piwright-static-'))
    writeFileSync(join(root, 'index.html'), '<html>spa</html>')
    running.push({ port: 0, root })
    const { port, cookie, server } = await startWithAuth(root)
    // /rpc: hand-rolled upgrade через attachRpcWs (rpcUpgrade) — 101 + hello-кадр.
    const rpc = await new Promise<{ head: string; hello: { t: string } }>((resolvePromise, reject) => {
      const socket = connect(port, '127.0.0.1', () => {
        socket.write(
          `GET /rpc HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n' +
            `Cookie: ${cookie}\r\n\r\n`
        )
      })
      const chunks: Buffer[] = []
      socket.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
        const buf = Buffer.concat(chunks)
        const idx = buf.indexOf('\r\n\r\n')
        if (idx < 0) return
        // Первый WS-кадр после хендшейка — hello из rpc-ws (маски нет, JSON текст).
        const rest = buf.subarray(idx + 4)
        if (rest.length < 2) return
        const len = rest[1] & 0x7f
        if (rest.length < 2 + len) return
        resolvePromise({
          head: buf.subarray(0, idx).toString('utf8').split('\r\n')[0],
          hello: JSON.parse(rest.subarray(2, 2 + len).toString('utf8')) as { t: string }
        })
        socket.destroy()
      })
      socket.on('error', reject)
    })
    expect(rpc.head).toContain('101')
    expect(rpc.hello).toEqual({ t: 'hello', platform: 'linux', version: 'test' })
    // Прочие апгрейды в статическом режиме гасятся: ни 101, ни эха.
    const other = await new Promise<string>((resolvePromise) => {
      const socket = connect(port, '127.0.0.1', () => {
        socket.write(
          `GET /other HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n' +
            `Cookie: ${cookie}\r\n\r\n`
        )
      })
      let data = ''
      socket.on('data', (chunk) => (data += chunk.toString('utf8')))
      socket.on('close', () => resolvePromise(data))
    })
    expect(other).not.toContain('101')
    server.stop()
  })
})
