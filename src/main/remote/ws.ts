/** WebSocket-соединение телефона (RFC 6455, серверная сторона). Порт `RemoteWebSocket.kt`
 *  + inner `WsConnection` из `RemoteWebServer.kt`: accept-key, кодирование кадров, чтение с
 *  фрагментацией, ping/pong, лимит сообщения 2 MiB. */
import { createHash } from 'node:crypto'
import type { Socket } from 'node:net'

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
export const MAX_MESSAGE_BYTES = 2 * 1024 * 1024

export function wsAcceptKey(clientKey: string): string {
  return createHash('sha1').update(clientKey + WS_GUID, 'ascii').digest('base64')
}

function encodeFrame(opcode: number, payload: Buffer): Buffer {
  const head = [0x80 | opcode]
  if (payload.length < 126) {
    head.push(payload.length)
  } else if (payload.length <= 0xffff) {
    head.push(126, payload.length >> 8, payload.length & 0xff)
  } else {
    head.push(127)
    for (let shift = 56; shift >= 0; shift -= 8) head.push((payload.length / 2 ** shift) & 0xff)
  }
  return Buffer.concat([Buffer.from(head), payload])
}

export interface RemoteSocket {
  readonly seq: number
  readonly peer: string
  send(line: string): void
  close(): void
}

export class WsConnection implements RemoteSocket {
  readonly seq: number
  readonly peer: string
  private closed = false
  private buffer: Buffer = Buffer.alloc(0)
  private fragments: Buffer[] = []

  constructor(
    seq: number,
    private readonly socket: Socket,
    private readonly onText: (text: string) => void,
    private readonly onClose: () => void
  ) {
    this.seq = seq
    this.peer = socket.remoteAddress ?? '?'
    socket.on('data', (chunk: Buffer) => this.consume(chunk))
    socket.on('error', () => this.close())
    socket.on('close', () => this.close())
  }

  send(line: string): void {
    if (!this.closed) this.socket.write(encodeFrame(0x1, Buffer.from(line, 'utf8')))
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    try {
      this.socket.write(encodeFrame(0x8, Buffer.from([0x03, 0xe8])))
    } catch {
      // сокет уже мёртв
    }
    this.socket.destroy()
    this.onClose()
  }

  private consume(chunk: Buffer): void {
    this.buffer = this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk])
    for (;;) {
      const frame = this.readFrame()
      if (frame === null) return
      this.deliver(frame)
      if (this.closed) return
    }
  }

  private readFrame(): { opcode: number; payload: Buffer; fin: boolean } | null {
    const buf = this.buffer
    if (buf.length < 2) return null
    const b0 = buf[0]
    const b1 = buf[1]
    const fin = (b0 & 0x80) !== 0
    const opcode = b0 & 0x0f
    const masked = (b1 & 0x80) !== 0
    let length = b1 & 0x7f
    let offset = 2
    if (length === 126) {
      if (buf.length < offset + 2) return null
      length = buf.readUInt16BE(offset)
      offset += 2
    } else if (length === 127) {
      if (buf.length < offset + 8) return null
      const big = buf.readBigUInt64BE(offset)
      if (big > BigInt(MAX_MESSAGE_BYTES)) {
        this.close()
        return null
      }
      length = Number(big)
      offset += 8
    }
    if (length > MAX_MESSAGE_BYTES) {
      this.close()
      return null
    }
    const maskLength = masked ? 4 : 0
    if (buf.length < offset + maskLength + length) return null
    const payload = Buffer.from(buf.subarray(offset + maskLength, offset + maskLength + length))
    if (masked) {
      const mask = buf.subarray(offset, offset + 4)
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]
    }
    this.buffer = buf.subarray(offset + maskLength + length)
    return { opcode, payload, fin }
  }

  private deliver(frame: { opcode: number; payload: Buffer; fin: boolean }): void {
    switch (frame.opcode) {
      case 0x0: {
        this.fragments.push(frame.payload)
        if (frame.fin) {
          const text = Buffer.concat(this.fragments).toString('utf8')
          this.fragments = []
          this.onText(text)
        }
        return
      }
      case 0x1: {
        if (frame.fin) {
          this.onText(frame.payload.toString('utf8'))
          return
        }
        this.fragments.push(frame.payload)
        return
      }
      case 0x8: {
        this.close()
        return
      }
      case 0x9: {
        this.socket.write(encodeFrame(0xa, frame.payload))
        return
      }
      default:
        return
    }
  }
}
