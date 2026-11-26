import { describe, expect, it } from 'vitest'
import { connect } from 'node:net'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { RemoteWebServer } from '../src/main/remote/server'
import { RemoteAuth } from '../src/main/remote/auth'
import { attachRpcWs } from '../src/main/remote/rpc-ws'
import { RpcRouter } from '../src/main/ipc/router'
import { EventBroadcaster } from '../src/main/ipc/events'

const listener = { onOpen: () => {}, onText: () => {}, onClose: () => {} }

/** POST /login с произвольными заголовками — статус + set-cookie. */
function postLogin(
  port: number,
  headers: Record<string, string>,
  secure = false
): Promise<{ status: number | undefined; cookie: string | undefined }> {
  const reqFn = secure ? httpsRequest : httpRequest
  return new Promise((resolvePromise, reject) => {
    const req = reqFn(
      { host: '127.0.0.1', port, path: '/login', method: 'POST', headers: { 'Content-Length': 10, ...headers }, rejectUnauthorized: false },
      (res: IncomingMessage) => {
        res.resume()
        res.on('end', () =>
          resolvePromise({
            status: res.statusCode,
            cookie: res.headers['set-cookie']?.find((c) => c.startsWith('pi_remote='))
          })
        )
      }
    )
    req.on('error', reject)
    req.end('pin=123456')
  })
}

function startServer(auth: RemoteAuth, tls?: { cert: Buffer; key: Buffer }): Promise<RemoteWebServer> {
  const rpc = attachRpcWs({ router: new RpcRouter(), events: new EventBroadcaster(), platform: 'linux', appVersion: 'test' })
  const server = new RemoteWebServer(0, auth, listener, () => 'en', rpc.upgrade, undefined, '127.0.0.1', tls)
  return server.start().then((started) => {
    if (!started.ok) throw new Error(`start failed: ${started.error}`)
    return server
  })
}

describe('web mode security: same-origin enforcement', () => {
  it('accepts a same-origin login POST', async () => {
    const server = await startServer(new RemoteAuth('123456'))
    const res = await postLogin(server.port, {
      Host: `127.0.0.1:${server.port}`,
      Origin: `http://127.0.0.1:${server.port}`
    })
    expect(res.status).toBe(303)
    expect(res.cookie).toBeDefined()
    server.stop()
  })

  it('accepts a login POST without Origin (non-browser client)', async () => {
    const server = await startServer(new RemoteAuth('123456'))
    const res = await postLogin(server.port, { Host: `127.0.0.1:${server.port}` })
    expect(res.status).toBe(303)
    server.stop()
  })

  it('rejects a cross-origin login POST with 403', async () => {
    const server = await startServer(new RemoteAuth('123456'))
    const res = await postLogin(server.port, {
      Host: `127.0.0.1:${server.port}`,
      Origin: 'http://evil.example'
    })
    expect(res.status).toBe(403)
    expect(res.cookie).toBeUndefined()
    server.stop()
  })

  it('matches Origin against X-Forwarded-Host behind a reverse proxy', async () => {
    const server = await startServer(new RemoteAuth('123456'))
    const res = await postLogin(server.port, {
      Host: '127.0.0.1',
      'X-Forwarded-Host': 'piwright.example.com',
      Origin: 'https://piwright.example.com'
    })
    expect(res.status).toBe(303)
    server.stop()
  })

  it('rejects a cross-origin WS upgrade before the handshake', async () => {
    const server = await startServer(new RemoteAuth('123456'))
    const head = await new Promise<string>((resolvePromise) => {
      const socket = connect(server.port, '127.0.0.1', () => {
        socket.write(
          `GET /rpc HTTP/1.1\r\nHost: 127.0.0.1:${server.port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n` +
            'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n' +
            'Origin: http://evil.example\r\n\r\n'
        )
      })
      let data = ''
      socket.on('data', (chunk) => {
        data += chunk.toString('utf8')
        if (data.includes('\r\n\r\n')) {
          socket.destroy()
          resolvePromise(data.split('\r\n')[0])
        }
      })
      socket.on('close', () => resolvePromise(data.split('\r\n')[0]))
    })
    expect(head).toContain('403')
    server.stop()
  })
})

describe('web mode security: TLS', () => {
  const fixture = join(__dirname, 'fixtures', 'web-tls')
  const tls = {
    cert: readFileSync(join(fixture, 'cert.pem')),
    key: readFileSync(join(fixture, 'key.pem'))
  }

  it('serves HTTPS login and sets a Secure cookie', async () => {
    const server = await startServer(new RemoteAuth('123456'), tls)
    const res = await postLogin(server.port, { Host: `127.0.0.1:${server.port}` }, true)
    expect(res.status).toBe(303)
    expect(res.cookie).toContain('Secure')
    server.stop()
  })

  it('serves static content over HTTPS with the session cookie', async () => {
    const server = await startServer(new RemoteAuth('123456'), tls)
    const login = await postLogin(server.port, { Host: `127.0.0.1:${server.port}` }, true)
    const cookie = login.cookie?.split(';')[0] ?? ''
    const body = await new Promise<string>((resolvePromise, reject) => {
      const req = httpsRequest(
        { host: '127.0.0.1', port: server.port, path: '/', headers: { Cookie: cookie }, rejectUnauthorized: false },
        (res: IncomingMessage) => {
          let data = ''
          res.on('data', (c) => (data += c))
          res.on('end', () => resolvePromise(data))
        }
      )
      req.on('error', reject)
      req.end()
    })
    // Без staticRoot сервер отдаёт вшитый телефонный UI — достаточно факта 200 HTML по HTTPS.
    expect(login.status).toBe(303)
    expect(body).toContain('<html')
    server.stop()
  })
})

describe('web mode security: session revocation on PIN change', () => {
  it('revokes cookie sessions when the static pin changes, no-op for the same pin', () => {
    const auth = new RemoteAuth('123456')
    const session = auth.newBrowserSession()
    expect(auth.isAuthorized(session)).toBe(true)
    auth.setStaticPin('654321')
    expect(auth.isAuthorized(session)).toBe(false)
    auth.setStaticPin('654321')
    expect(auth.isAuthorized(session)).toBe(false)
    const fresh = auth.newBrowserSession()
    expect(auth.isAuthorized(fresh)).toBe(true)
    auth.setStaticPin('654321')
    expect(auth.isAuthorized(fresh)).toBe(true)
    auth.setStaticPin(null)
    expect(auth.isAuthorized(fresh)).toBe(false)
  })
})
