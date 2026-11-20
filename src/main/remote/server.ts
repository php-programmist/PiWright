/** HTTP + WebSocket сервер для телефона. Слушает LAN (0.0.0.0), отдаёт страницу входа и статику
 *  (вшита ?raw-импортами), апгрейдит любой Upgrade в WebSocket. Порт `RemoteWebServer.kt`;
 *  вместо ручного HTTP-парсинга — node:http, WebSocket остался ручным (ws.ts). */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import type { AddressInfo, Socket as NetSocket } from 'node:net'
import { networkInterfaces } from 'node:os'
import type { RemoteAuth } from './auth'
import type { RemoteSocket } from './ws'
import { WsConnection, wsAcceptKey } from './ws'

import indexHtml from '../../../resources/remote/index.html?raw'
import appJs from '../../../resources/remote/app.js?raw'
import styleCss from '../../../resources/remote/style.css?raw'

const COOKIE_NAME = 'pi_remote'

export interface RemoteWebServerListener {
  onOpen(socket: RemoteSocket): void
  onText(socket: RemoteSocket, text: string): void
  onClose(socket: RemoteSocket): void
}

export interface LanCandidate {
  name: string
  address: string
}

/** IPv4 site-local адреса хоста — кандидаты URL для телефона. */
export function lanCandidates(): [string, string][] {
  const result: [string, string][] = []
  const interfaces = networkInterfaces()
  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && addr.internal === false) result.push([name, addr.address])
    }
  }
  return result
}

/** Занят ли порт для бинда на 0.0.0.0 (так слушает remote-мост) — пробный listen. */
export function isPortBusy(port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createNetServer()
    let settled = false
    const done = (busy: boolean): void => {
      if (settled) return
      settled = true
      server.close()
      resolve(busy)
    }
    const timer = setTimeout(() => done(true), timeoutMs)
    timer.unref()
    server.once('error', () => {
      clearTimeout(timer)
      done(true)
    })
    server.listen(port, '0.0.0.0', () => {
      clearTimeout(timer)
      done(false)
    })
  })
}

function cookieToken(req: IncomingMessage): string | null {
  const header = req.headers.cookie
  if (header === undefined) return null
  for (const pair of header.split(';')) {
    const trimmed = pair.trim()
    if (trimmed.startsWith(`${COOKIE_NAME}=`)) return trimmed.slice(COOKIE_NAME.length + 1)
  }
  return null
}

function writeHttp(res: ServerResponse, status: number, contentType: string, body: string): void {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    Connection: 'close'
  })
  res.end(body)
}

function writeRedirect(res: ServerResponse, location: string, cookieTokenValue: string | null): void {
  const headers: Record<string, string> = { Location: location, Connection: 'close' }
  if (cookieTokenValue !== null) {
    headers['Set-Cookie'] = `${COOKIE_NAME}=${cookieTokenValue}; HttpOnly; SameSite=Strict; Path=/`
  }
  res.writeHead(303, headers)
  res.end()
}

function loginPage(error: boolean): string {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>piwright remote — вход</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:#101014;color:#e6e8ea;font:15px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif}
  form{width:min(340px,88vw);background:#17171c;border:1px solid #2a2a33;border-radius:14px;
       padding:22px 20px;box-shadow:0 12px 40px rgba(0,0,0,.45)}
  h1{font-size:16px;margin:0 0 4px;font-weight:650}
  p{color:#9aa0a4;margin:0 0 16px;font-size:13px}
  input{width:100%;box-sizing:border-box;background:#101014;border:1px solid #2a2a33;border-radius:9px;
        padding:12px 14px;color:#e6e8ea;font:600 20px/1 ui-monospace,monospace;letter-spacing:.18em;text-align:center}
  button{margin-top:12px;width:100%;padding:12px;border:0;border-radius:9px;background:#3f7fbf;color:#fff;
         font:600 14px/1 inherit}
  .err{color:#e07a72;font-size:13px;margin:10px 0 0}
</style></head><body>
<form method="post" action="/login">
  <h1>piwright remote</h1>
  <p>Введи PIN из настроек Piwright (Notifications → Remote).</p>
  <input name="pin" inputmode="numeric" autocomplete="one-time-code" autofocus maxlength="7" placeholder="000 000">
  <button type="submit">Войти</button>
  ${error ? '<div class="err">Неверный PIN или слишком много попыток.</div>' : ''}
</form></body></html>`
}

function parseForm(body: string): Map<string, string> {
  const result = new Map<string, string>()
  for (const pair of body.split('&')) {
    const eq = pair.indexOf('=')
    if (eq <= 0) continue
    result.set(decodeURIComponent(pair.slice(0, eq)), decodeURIComponent(pair.slice(eq + 1)))
  }
  return result
}

function mimeTypeFor(name: string): string {
  if (name.endsWith('.js')) return 'text/javascript; charset=utf-8'
  if (name.endsWith('.css')) return 'text/css; charset=utf-8'
  return 'text/html; charset=utf-8'
}

export class RemoteWebServer {
  private server: Server | null = null
  private nextSeq = 1
  private stopped = false

  port = 0

  constructor(
    private readonly requestedPort: number,
    private readonly auth: RemoteAuth,
    private readonly listener: RemoteWebServerListener
  ) {}

  async start(): Promise<boolean> {
    const server = createServer((req, res) => {
      void this.handleRequest(req, res).catch(() => {
        try {
          res.destroy()
        } catch {
          // соединение уже закрыто
        }
      })
    })
    server.on('upgrade', (req, socket) => this.handleUpgrade(req, socket as NetSocket))
    server.on('clientError', (_err, socket) => socket.destroy())
    return await new Promise<boolean>((resolve) => {
      const once = (error: unknown): void => {
        server.removeListener('error', once)
        resolve(false)
        void error
      }
      server.once('error', once)
      server.listen(this.requestedPort, '0.0.0.0', () => {
        server.removeListener('error', once)
        const address = server.address() as AddressInfo
        this.port = address.port
        this.server = server
        this.stopped = false
        resolve(true)
      })
    })
  }

  stop(): void {
    this.stopped = true
    this.server?.close()
    this.server = null
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? '/').split('?')[0]
    if (path === '/login' && req.method === 'GET') {
      const error = (req.url ?? '').includes('e=1')
      writeHttp(res, 200, 'text/html; charset=utf-8', loginPage(error))
      return
    }
    if (path === '/login' && req.method === 'POST') {
      const body = await readBody(req)
      const pin = parseForm(body).get('pin') ?? ''
      const peer = req.socket.remoteAddress ?? '?'
      if (this.auth.isLocked(peer)) {
        writeHttp(res, 429, 'text/html; charset=utf-8', loginPage(true))
        return
      }
      if (this.auth.checkPin(pin)) {
        this.auth.clearFailures(peer)
        writeRedirect(res, '/', this.auth.newBrowserSession())
        return
      }
      this.auth.noteFailure(peer)
      writeRedirect(res, '/login?e=1', null)
      return
    }
    if (!this.auth.isAuthorized(cookieToken(req))) {
      writeRedirect(res, '/login', null)
      return
    }
    const resource =
      path === '/' || path === '/index.html' ? indexHtml : path === '/app.js' ? appJs : path === '/style.css' ? styleCss : null
    if (resource === null) {
      writeHttp(res, 404, 'text/plain', 'Not found')
      return
    }
    writeHttp(res, 200, mimeTypeFor(path), resource)
  }

  private handleUpgrade(req: IncomingMessage, socket: NetSocket): void {
    if (this.stopped) {
      socket.destroy()
      return
    }
    if (!this.auth.isAuthorized(cookieToken(req))) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    const key = req.headers['sec-websocket-key']
    if (typeof key !== 'string' || key.length === 0) {
      socket.destroy()
      return
    }
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${wsAcceptKey(key)}\r\n\r\n`
    )
    const connection = new WsConnection(
      this.nextSeq++,
      socket,
      (text) => this.listener.onText(connection, text),
      () => this.listener.onClose(connection)
    )
    this.listener.onOpen(connection)
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  const length = Number(req.headers['content-length'] ?? 0)
  if (!Number.isFinite(length) || length <= 0 || length > 1024 * 1024) return ''
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > length) break
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}
