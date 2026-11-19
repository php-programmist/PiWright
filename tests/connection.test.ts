import { describe, expect, it } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import { PiConnection } from '../src/main/pi/connection'
import type { PiConnectionListener } from '../src/main/pi/connection'
import type { PiSpawner } from '../src/main/pi/backends/types'
import { FakeChild } from './helpers/fake-child'

function makeRecorder() {
  const events: string[] = []
  const uiRequests: string[] = []
  const disconnects: Array<{ cause: string | null; exitCode: number | null; stderrTail: string }> = []
  const listener: PiConnectionListener & {
    events: string[]
    uiRequests: string[]
    disconnects: typeof disconnects
  } = {
    events,
    uiRequests,
    disconnects,
    onEvent: (type) => events.push(type),
    onExtensionUiRequest: (id, method) => uiRequests.push(`${id}:${method}`),
    onDisconnected: (cause, exitCode, stderrTail) => disconnects.push({ cause, exitCode, stderrTail })
  }
  return listener
}

function spawnerFor(child: FakeChild): PiSpawner {
  return async () => child as unknown as ChildProcess
}

function sentLines(child: FakeChild): Array<Record<string, unknown>> {
  const data = child.stdin.read() as Buffer | null
  if (data === null) return []
  return data
    .toString('utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l))
}

describe('PiConnection', () => {
  it('responses are matched by id even out of order, events and ui requests pass through', async () => {
    const child = new FakeChild()
    const listener = makeRecorder()
    const conn = new PiConnection(spawnerFor(child), listener)
    await conn.start({ cwd: 'C:\\w', args: [] })

    const promiseA = conn.request('get_state')
    const promiseB = conn.request('get_commands')
    const sent = sentLines(child)
    expect(sent.map((l) => l['id'])).toEqual(['1', '2'])
    expect(sent.map((l) => l['type'])).toEqual(['get_state', 'get_commands'])

    child.emitData('{"id":"2","type":"response","command":"get_commands","success":true}\r\n')
    child.emitData('{"type":"agent_start"}\n{"type":"extension_ui_request","id":"u1","method":"notify"}\n')
    child.emitData('{"id":"1","type":"resp')
    child.emitData('onse","command":"get_state","success":true}\n')
    child.closeWith(0)

    await expect(promiseB).resolves.toMatchObject({ command: 'get_commands' })
    await expect(promiseA).resolves.toMatchObject({ command: 'get_state' })
    expect(listener.events).toEqual(['agent_start'])
    expect(listener.uiRequests).toEqual(['u1:notify'])
    expect(listener.disconnects).toEqual([{ cause: null, exitCode: 0, stderrTail: '' }])
  })

  it('respondExtensionUi writes an extension_ui_response line', async () => {
    const child = new FakeChild()
    const conn = new PiConnection(spawnerFor(child), makeRecorder())
    await conn.start({ cwd: 'C:\\w', args: [] })
    conn.respondExtensionUi('u7', { value: 'Allow' })
    const line = sentLines(child)[0]
    expect(line['type']).toBe('extension_ui_response')
    expect(line['id']).toBe('u7')
    expect(line['value']).toBe('Allow')
    conn.close()
  })

  it('nothing is written after close and pending requests reject', async () => {
    const child = new FakeChild()
    const conn = new PiConnection(spawnerFor(child), makeRecorder())
    await conn.start({ cwd: 'C:\\w', args: [] })
    conn.close()
    await expect(conn.request('abort')).rejects.toThrow('pi connection is not running')
    expect(sentLines(child)).toEqual([])
  })

  it('pending requests are rejected when the process dies, with stderr tail', async () => {
    const child = new FakeChild()
    const listener = makeRecorder()
    const conn = new PiConnection(spawnerFor(child), listener)
    await conn.start({ cwd: 'C:\\w', args: [] })
    const pending = conn.request('get_state')
    child.stderr.write('boom happened\n')
    child.closeWith(1)
    await expect(pending).rejects.toThrow('stderr: boom happened')
    expect(listener.disconnects).toHaveLength(1)
    expect(listener.disconnects[0].exitCode).toBe(1)
    expect(listener.disconnects[0].stderrTail).toBe('boom happened')
  })

  it('spawn error is reported as a disconnect', async () => {
    const failing: PiSpawner = async () => {
      const child = new FakeChild()
      process.nextTick(() => child.emit('error', new Error('ENOENT')))
      return child as unknown as ChildProcess
    }
    const listener = makeRecorder()
    const conn = new PiConnection(failing, listener)
    await conn.start({ cwd: 'C:\\w', args: [] })
    await expect(conn.request('get_state')).rejects.toThrow('ENOENT')
    expect(listener.disconnects).toHaveLength(1)
    expect(listener.disconnects[0].cause).toBe('ENOENT')
  })

  it('double disconnect is delivered once', async () => {
    const child = new FakeChild()
    const listener = makeRecorder()
    const conn = new PiConnection(spawnerFor(child), listener)
    await conn.start({ cwd: 'C:\\w', args: [] })
    child.emit('error', new Error('x'))
    child.closeWith(0)
    expect(listener.disconnects).toHaveLength(1)
    conn.close()
    expect(listener.disconnects).toHaveLength(1)
  })

  it('close rejects pending and marks connection dead', async () => {
    const child = new FakeChild()
    const conn = new PiConnection(spawnerFor(child), makeRecorder())
    await conn.start({ cwd: 'C:\\w', args: [] })
    const pending = conn.request('get_state')
    conn.close()
    await expect(pending).rejects.toThrow('pi connection was closed')
    expect(conn.running).toBe(false)
  })
})
