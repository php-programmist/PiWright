import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'

/** Процесс-заглушка: тест пишет «stdout pi» в child, читает «stdin pi» из child.stdin. */
export class FakeChild extends EventEmitter implements Pick<ChildProcess, 'stdin' | 'stdout' | 'stderr' | 'kill'> {
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly stdin = new PassThrough()
  killed = false

  kill(): boolean {
    this.killed = true
    return true
  }

  emitData(text: string): void {
    this.stdout.write(text)
  }

  closeWith(code: number | null): void {
    this.stdout.end()
    this.stderr.end()
    this.emit('close', code)
  }
}

/** Заглушка, отвечающая на команды по скрипту: type → данные ответа `success:true`. */
export class ScriptedChild extends FakeChild {
  private buffer = ''
  readonly sent: Array<Record<string, unknown>> = []

  constructor(private readonly respond: (type: string, fields: Record<string, unknown>) => unknown) {
    super()
    this.stdin.setEncoding('utf8')
    this.stdin.on('data', (chunk: string) => this.onStdin(chunk))
  }

  private onStdin(chunk: string): void {
    this.buffer += chunk
    for (;;) {
      const nl = this.buffer.indexOf('\n')
      if (nl < 0) break
      const line = this.buffer.slice(0, nl)
      this.buffer = this.buffer.slice(nl + 1)
      if (line.trim().length === 0) continue
      const parsed = JSON.parse(line) as Record<string, unknown>
      this.sent.push(parsed)
      const data = this.respond(String(parsed['type']), parsed)
      this.emitData(JSON.stringify({ id: parsed['id'], type: 'response', command: parsed['type'], success: true, data }) + '\n')
    }
  }
}
