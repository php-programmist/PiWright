/** Живая проверка MCP-сервера: initialize → notifications/initialized → tools/list.
 *  Транспорты: stdio (spawn; для WSL — через `wsl.exe … bash -lic`) и streamable HTTP (POST).
 *  Минимальный клиент: только подсчёт инструментов, без oauth/resources/subscriptions. */
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import type { PiJsonObject } from '../../shared/protocol-types'
import type { McpProbeResult } from '../../shared/ipc-contracts'
import { errorMessage } from '../../shared/errors'

const PROBE_TIMEOUT_MS = 10_000
const PROTOCOL_VERSION = '2025-06-18'
interface JsonRpcResponse {
  id: number
  result: PiJsonObject | null
  error: { message: string } | null
}

interface WslOptions {
  distro: string
  cwd: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function toolCountOf(result: PiJsonObject | null): number {
  const tools = result?.['tools']
  return Array.isArray(tools) ? tools.filter(isRecord).length : 0
}

/** Проверка сервера по его конфигу из mcp.json. wsl — спавн внутри дистрибутива. */
export async function probeMcp(config: Record<string, unknown>, wsl: WslOptions | null): Promise<McpProbeResult> {
  try {
    if (typeof config['url'] === 'string' && config['url'].length > 0) {
      return await probeHttp(config)
    }
    if (typeof config['command'] === 'string' && config['command'].length > 0) {
      return await probeStdio(config, wsl)
    }
    return { ok: false, error: 'Server has neither command nor url', toolCount: 0, serverError: null }
  } catch (err) {
    return { ok: false, error: errorMessage(err), toolCount: 0, serverError: null }
  }
}

// ------------------------------------------------------------------ stdio

function probeStdio(config: Record<string, unknown>, wsl: WslOptions | null): Promise<McpProbeResult> {
  const command = config['command'] as string
  const args = Array.isArray(config['args']) ? config['args'].filter((a): a is string => typeof a === 'string') : []
  const envConfig = isRecord(config['env']) ? (config['env'] as Record<string, unknown>) : {}
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(envConfig)) {
    if (typeof value === 'string') env[key] = value
  }
  return new Promise((resolve) => {
    let child: ChildProcess
    if (wsl !== null) {
      const quoted = [command, ...args].map((part) => `'${part.replaceAll("'", `'\\''`)}'`).join(' ')
      const exports = Object.entries(env)
        .map(([key, value]) => `export ${key}=${shellQuoteValue(value)}; `)
        .join('')
      const spawnArgs = ['-d', wsl.distro, '--exec', 'bash', '-lic', `${exports}${quoted}`]
      child = spawn('wsl.exe', spawnArgs, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    } else {
      child = spawn(command, args, {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: typeof config['cwd'] === 'string' && config['cwd'].length > 0 ? config['cwd'] : undefined,
        env: Object.keys(env).length > 0 ? { ...process.env, ...env } : undefined
      })
    }
    finishStdioProbe(child, resolve)
  })
}

function shellQuoteValue(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

function finishStdioProbe(child: ChildProcess, resolve: (result: McpProbeResult) => void): void {
  let buffer = ''
  const responses = new Map<number, JsonRpcResponse>()
  let stderrTail = ''
  let nextId = 1
  let settled = false

  const done = (result: McpProbeResult): void => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    try {
      child.kill()
    } catch {
      // уже умер
    }
    resolve(result)
  }

  const timer = setTimeout(() => {
    done({ ok: false, error: `timed out after ${PROBE_TIMEOUT_MS / 1000}s`, toolCount: 0, serverError: stderrTail.slice(-200) || null })
  }, PROBE_TIMEOUT_MS)
  timer.unref()

  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => {
    buffer += chunk
    for (;;) {
      const nl = buffer.indexOf('\n')
      if (nl < 0) return
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (line.length === 0) continue
      try {
        const parsed: unknown = JSON.parse(line)
        if (isRecord(parsed) && typeof parsed['id'] === 'number') {
          responses.set(parsed['id'], {
            id: parsed['id'],
            result: isRecord(parsed['result']) ? (parsed['result'] as PiJsonObject) : null,
            error: isRecord(parsed['error']) ? { message: String(parsed['error']['message'] ?? 'error') } : null
          })
        }
      } catch {
        // не-JSON строки сервера игнорируем
      }
    }
  })
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-400)
  })
  child.on('error', (err: Error) => {
    done({ ok: false, error: err.message, toolCount: 0, serverError: null })
  })
  child.on('close', (code) => {
    done({ ok: false, error: `server exited (code ${code ?? '?'})`, toolCount: 0, serverError: stderrTail.slice(-200) || null })
  })

  const send = (payload: Record<string, unknown>): void => {
    child.stdin?.write(JSON.stringify(payload) + '\n')
  }

  const step2 = (): void => {
    const toolsId = nextId++
    send({ jsonrpc: '2.0', id: toolsId, method: 'tools/list', params: {} })
    waitFor(toolsId, (response) => {
      if (response === null) return
      if (response.error !== null) {
        done({ ok: true, error: null, toolCount: 0, serverError: response.error.message })
        return
      }
      done({ ok: true, error: null, toolCount: toolCountOf(response.result), serverError: null })
    })
  }

  const waitFor = (id: number, cb: (response: JsonRpcResponse | null) => void): void => {
    const check = (): void => {
      if (settled) return
      const response = responses.get(id)
      if (response !== undefined) {
        responses.delete(id)
        cb(response)
        return
      }
      setTimeout(check, 50)
    }
    check()
  }

  const initId = nextId++
  send({
    jsonrpc: '2.0',
    id: initId,
    method: 'initialize',
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'piwright', version: '0.1.0' }
    }
  })
  waitFor(initId, (response) => {
    if (response === null) return
    if (response.error !== null) {
      done({ ok: false, error: response.error.message, toolCount: 0, serverError: null })
      return
    }
    send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    step2()
  })
}

// ------------------------------------------------------------------- http

async function probeHttp(config: Record<string, unknown>): Promise<McpProbeResult> {
  const url = config['url'] as string
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }
  const headersConfig = isRecord(config['headers']) ? (config['headers'] as Record<string, unknown>) : {}
  for (const [key, value] of Object.entries(headersConfig)) {
    if (typeof value === 'string') headers[key] = value
  }
  let sessionId: string | null = null

  const post = async (payload: Record<string, unknown>): Promise<{ json: PiJsonObject | null; error: string | null }> => {
    const allHeaders = sessionId !== null ? { ...headers, 'Mcp-Session-Id': sessionId } : headers
    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: allHeaders,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
      })
    } catch (err) {
      return { json: null, error: errorMessage(err) }
    }
    const sid = response.headers.get('mcp-session-id')
    if (sid !== null) sessionId = sid
    const text = await response.text().catch(() => '')
    if (!response.ok) {
      return { json: null, error: text.slice(0, 200) || `HTTP ${response.status}` }
    }
    return { json: parseRpcBody(text), error: null }
  }

  const init = await post({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'piwright', version: '0.1.0' } }
  })
  if (init.error !== null) return { ok: false, error: init.error, toolCount: 0, serverError: null }
  if (init.json === null) return { ok: false, error: 'empty initialize response', toolCount: 0, serverError: null }
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' }).catch(() => null)
  const tools = await post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
  if (tools.error !== null) return { ok: false, error: tools.error, toolCount: 0, serverError: null }
  return { ok: true, error: null, toolCount: toolCountOf(tools.json), serverError: null }
}

/** JSON или SSE (`data:`-строки) → JSON-RPC результат последнего кадра с id. */
function parseRpcBody(text: string): PiJsonObject | null {
  const trimmed = text.trim()
  if (trimmed.length === 0) return null
  if (trimmed.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(trimmed)
      return isRecord(parsed) && isRecord(parsed['result']) ? (parsed['result'] as PiJsonObject) : null
    } catch {
      return null
    }
  }
  const dataLines = trimmed
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
  for (let i = dataLines.length - 1; i >= 0; i--) {
    try {
      const parsed: unknown = JSON.parse(dataLines[i])
      if (isRecord(parsed) && isRecord(parsed['result'])) return parsed['result'] as PiJsonObject
    } catch {
      // пробуем предыдущую строку
    }
  }
  return null
}
