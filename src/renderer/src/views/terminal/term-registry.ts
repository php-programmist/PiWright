/** Реестр xterm-инстансов renderer'а: один Terminal + host-div на терминал, живут вне React
 *  (переживают смену вкладки/проекта/закрытие панели — DOM переезжает, scrollback сохраняется).
 *  Данные, пришедшие до первого монтирования, буферизуются и сбрасываются при создании. */
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'

const PENDING_LIMIT = 512 * 1024

interface Entry {
  term: Terminal
  fit: FitAddon
  host: HTMLDivElement
}

const entries = new Map<string, Entry>()
const pending = new Map<string, string[]>()

function flushPending(id: string, entry: Entry): void {
  const chunks = pending.get(id)
  if (chunks === undefined) return
  pending.delete(id)
  for (const chunk of chunks) entry.term.write(chunk)
}

export function ensureEntry(id: string): Entry {
  const existing = entries.get(id)
  if (existing !== undefined) return existing
  const term = new Terminal({
    scrollback: 5000,
    fontFamily: 'Consolas, "Cascadia Mono", monospace',
    fontSize: 13,
    theme: { background: '#14161a', foreground: '#d7dce2' }
  })
  const fit = new FitAddon()
  term.loadAddon(fit)
  try {
    term.loadAddon(new WebglAddon())
  } catch {
    // WebGL недоступен — остаётся канвас/DOM-рендерер
  }
  const host = document.createElement('div')
  host.className = 'term-host'
  term.open(host)
  term.onData((data) => window.piwright.termInput(id, data))
  term.onResize(({ cols, rows }) => window.piwright.termResize(id, cols, rows))
  const entry: Entry = { term, fit, host }
  entries.set(id, entry)
  flushPending(id, entry)
  return entry
}

export function termWrite(id: string, data: string): void {
  const entry = entries.get(id)
  if (entry !== undefined) {
    entry.term.write(data)
    return
  }
  const chunks = pending.get(id) ?? []
  chunks.push(data)
  let total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  while (total > PENDING_LIMIT && chunks.length > 1) {
    total -= chunks[0].length
    chunks.shift()
  }
  pending.set(id, chunks)
}

export function termWriteExit(id: string, code: number): void {
  termWrite(id, `\r\n\x1b[90m[process exited with code ${code}]\x1b[0m\r\n`)
}

/** Создать инстанс при первом монтировании, прицепить host к mount-точке, подогнать размер,
 *  вернуть фокус. */
export function attach(id: string, mount: HTMLElement): void {
  const entry = ensureEntry(id)
  mount.appendChild(entry.host)
  fit(id)
  entry.term.focus()
}

export function detach(id: string): void {
  const entry = entries.get(id)
  if (entry === undefined) return
  entry.host.remove()
}

export function fit(id: string): void {
  const entry = entries.get(id)
  if (entry === undefined || !entry.host.isConnected) return
  const mount = entry.host.parentElement
  if (mount === null || mount.clientWidth === 0 || mount.clientHeight === 0) return
  try {
    entry.fit.fit()
  } catch {
    // нулевые размеры — пропускаем
  }
}

export function disposeEntry(id: string): void {
  entries.get(id)?.term.dispose()
  entries.delete(id)
  pending.delete(id)
}
