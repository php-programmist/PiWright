/** Копит чанки stdout и отдаёт колбэку только полные непустые строки.
 *  Правила протокола: резать только по LF, CR перед LF срезать, пустые строки пропускать. */
export class NdjsonAccumulator {
  private buffer = ''

  constructor(private readonly onLine: (line: string) => void) {}

  append(text: string): void {
    this.buffer += text
    for (;;) {
      const newline = this.buffer.indexOf('\n')
      if (newline < 0) break
      const line = this.buffer.slice(0, newline).replace(/\r+$/, '')
      this.buffer = this.buffer.slice(newline + 1)
      if (line.trim().length > 0) this.onLine(line)
    }
  }

  flush(): void {
    const rest = this.buffer.trim()
    this.buffer = ''
    if (rest.length > 0) this.onLine(rest)
  }
}
