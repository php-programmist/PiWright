/** Файловая система проекта: host (Windows-пути и UNC WSL — обычный node fs) или ssh (SFTP
 *  удалённого сервера, POSIX-пути). Единая точка для всех сервисов, читающих/пишущих файлы
 *  проекта; сепараторы — через join/dirname/basename реализации. */
import { createReadStream } from 'node:fs'
import { createInterface } from 'node:readline'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { basename as winBasename, dirname as winDirname, join as winJoin } from 'node:path'
import { posix } from 'node:path'
import type { SFTPWrapper } from 'ssh2'
import type { ProjectEntry, Settings } from '../../shared/ipc-contracts'
import { getSshService } from '../ssh/ssh-service'
import { listWslDistros, resolveWslHome } from '../pi/backends/wsl'

export interface FsEntry {
  name: string
  isDir: boolean
  size: number
  mtimeMs: number
}

/** Ретраи rename на Windows (EPERM/EBUSY: антивирус, индексатор, 9P). */
const RENAME_RETRY_MAX = 20

/** SFTPWrapper в promise-режиме: методы ssh2 — только callback-стиль, оборачиваем вручную. */
interface SftpEntry {
  filename: string
  attrs: { isDirectory(): boolean; size?: number; mtime?: number }
}
interface SftpStat {
  isDirectory(): boolean
  size?: number
  mtime?: number
}
type SftpHandle = Record<string, unknown>
type SftpPromises = {
  readdir(path: string): Promise<SftpEntry[]>
  readFile(path: string): Promise<Buffer>
  writeFile(path: string, data: Buffer | string): Promise<void>
  mkdir(path: string): Promise<void>
  unlink(path: string): Promise<void>
  rmdir(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  stat(path: string): Promise<SftpStat>
  open(path: string, flags: string): Promise<SftpHandle>
  close(handle: SftpHandle): Promise<void>
  read(handle: SftpHandle, buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }>
  write(handle: SftpHandle, buffer: Buffer, offset: number, length: number, position: number): Promise<void>
}

async function sftpPromises(sftpPromise: Promise<SFTPWrapper>): Promise<SftpPromises> {
  const sftp = await sftpPromise
  const call = <T>(fn: (cb: (err: Error | null | undefined, res?: T) => void) => void): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      fn((err, res) => (err !== null && err !== undefined ? reject(err) : resolve(res as T)))
    })
  return {
    readdir: (path) => call((cb) => sftp.readdir(path, (err, list) => cb(err, list as SftpEntry[]))),
    readFile: (path) => call((cb) => sftp.readFile(path, (err, buf) => cb(err, buf as Buffer))),
    writeFile: (path, data) => call((cb) => sftp.writeFile(path, data as string, (err) => cb(err))),
    mkdir: (path) => call((cb) => sftp.mkdir(path, (err) => cb(err))),
    unlink: (path) => call((cb) => sftp.unlink(path, (err) => cb(err))),
    rmdir: (path) => call((cb) => sftp.rmdir(path, (err) => cb(err))),
    rename: (from, to) => call((cb) => sftp.rename(from, to, (err) => cb(err))),
    stat: (path) => call((cb) => sftp.stat(path, (err, st) => cb(err, st as SftpStat))),
    open: (path, flags) => call((cb) => sftp.open(path, flags as never, (err, handle) => cb(err, handle as unknown as SftpHandle))),
    close: (handle) => call((cb) => sftp.close(handle as unknown as Buffer, (err) => cb(err))),
    read: (handle, buffer, offset, length, position) =>
      call((cb) => sftp.read(handle as unknown as Buffer, buffer, offset, length, position, (err, bytesRead) => cb(err, { bytesRead }))),
    write: (handle, buffer, offset, length, position) =>
      call((cb) => sftp.write(handle as unknown as Buffer, buffer, offset, length, position, (err) => cb(err)))
  }
}

export interface ProjectFs {
  readonly backend: 'host' | 'ssh'
  join(...parts: string[]): string
  dirname(path: string): string
  basename(path: string): string
  readdir(path: string): Promise<FsEntry[]>
  readFile(path: string): Promise<Buffer>
  readText(path: string): Promise<string>
  writeFile(path: string, data: Buffer | string): Promise<void>
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>
  /** Файл — unlink, каталог — рекурсивно. */
  rm(path: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  stat(path: string): Promise<FsEntry | null>
  exists(path: string): Promise<boolean>
  /** Первые maxBytes файла строкой (заголовки JSONL без чтения всего файла). */
  readHead(path: string, maxBytes: number): Promise<string>
  /** Построчное чтение (JSONL сессий); maxBytes — потолок чтения (дефолт 64 МБ). */
  lines(path: string, maxBytes?: number): AsyncIterable<string>
  /** Эксклюзивное создание (lock-файлы, 'wx'): true — создан, false — занят/ошибка. */
  createExclusive(path: string, data: Buffer | string): Promise<boolean>
  /** Переименование с перезаписью цели (атомарная запись досок). */
  renameOverwrite(from: string, to: string): Promise<void>
}

export class HostProjectFs implements ProjectFs {
  readonly backend = 'host' as const

  join(...parts: string[]): string {
    return winJoin(...parts)
  }

  dirname(path: string): string {
    return winDirname(path)
  }

  basename(path: string): string {
    return winBasename(path)
  }

  async readdir(path: string): Promise<FsEntry[]> {
    const items = await fs.readdir(path, { withFileTypes: true })
    const out: FsEntry[] = []
    for (const item of items) {
      try {
        const st = await fs.stat(this.join(path, item.name))
        out.push({ name: item.name, isDir: item.isDirectory(), size: st.size, mtimeMs: st.mtimeMs })
      } catch {
        out.push({ name: item.name, isDir: item.isDirectory(), size: 0, mtimeMs: 0 })
      }
    }
    return out
  }

  readFile(path: string): Promise<Buffer> {
    return fs.readFile(path)
  }

  async readText(path: string): Promise<string> {
    return fs.readFile(path, 'utf8')
  }

  writeFile(path: string, data: Buffer | string): Promise<void> {
    return fs.writeFile(path, data)
  }

  async mkdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
    await fs.mkdir(path, { recursive: opts?.recursive ?? false })
  }

  async rm(path: string): Promise<void> {
    await fs.rm(path, { recursive: true, force: false })
  }

  rename(from: string, to: string): Promise<void> {
    return fs.rename(from, to)
  }

  async stat(path: string): Promise<FsEntry | null> {
    try {
      const st = await fs.stat(path)
      return { name: winBasename(path), isDir: st.isDirectory(), size: st.size, mtimeMs: st.mtimeMs }
    } catch {
      return null
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await fs.stat(path)
      return true
    } catch {
      return false
    }
  }

  async readHead(path: string, maxBytes: number): Promise<string> {
    const handle = await fs.open(path, 'r')
    try {
      const buffer = Buffer.alloc(maxBytes)
      const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0)
      return buffer.toString('utf8', 0, bytesRead)
    } finally {
      await handle.close()
    }
  }

  async *lines(path: string, maxBytes = 64 * 1024 * 1024): AsyncIterable<string> {
    const stream = createReadStream(path, { encoding: 'utf8', end: maxBytes })
    const reader = createInterface({ input: stream, crlfDelay: Infinity })
    try {
      for await (const line of reader) yield line
    } finally {
      reader.close()
      stream.close()
    }
  }

  async createExclusive(path: string, data: Buffer | string): Promise<boolean> {
    try {
      const handle = await fs.open(path, 'wx')
      try {
        await handle.writeFile(data)
      } finally {
        await handle.close()
      }
      return true
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      // EPERM: Windows оставляет только что удалённое имя в pending-delete — это «занято».
      if (code === 'EEXIST' || code === 'EPERM') return false
      throw err
    }
  }

  async renameOverwrite(from: string, to: string): Promise<void> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await fs.rename(from, to)
        return
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code
        if ((code !== 'EPERM' && code !== 'EBUSY') || attempt >= RENAME_RETRY_MAX) throw err
        await new Promise((resolve) => setTimeout(resolve, 25 + attempt * 5))
      }
    }
  }
}

export class SshProjectFs implements ProjectFs {
  readonly backend = 'ssh' as const

  constructor(
    private readonly sftp: () => Promise<SFTPWrapper>
  ) {}

  join(...parts: string[]): string {
    return posix.join(...parts)
  }

  dirname(path: string): string {
    return posix.dirname(path)
  }

  basename(path: string): string {
    return posix.basename(path)
  }

  async readdir(path: string): Promise<FsEntry[]> {
    const sftp = await sftpPromises(this.sftp())
    const items = await sftp.readdir(path)
    return items.map((item) => ({
      name: item.filename,
      isDir: item.attrs.isDirectory(),
      size: Number(item.attrs.size ?? 0),
      mtimeMs: Number(item.attrs.mtime ?? 0) * 1000
    }))
  }

  async readFile(path: string): Promise<Buffer> {
    const sftp = await sftpPromises(this.sftp())
    return sftp.readFile(path)
  }

  async readText(path: string): Promise<string> {
    const buffer = await this.readFile(path)
    return buffer.toString('utf8')
  }

  async writeFile(path: string, data: Buffer | string): Promise<void> {
    const sftp = await sftpPromises(this.sftp())
    await sftp.writeFile(path, data)
  }

  async mkdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
    const sftp = await sftpPromises(this.sftp())
    if (opts?.recursive !== true) {
      await sftp.mkdir(path)
      return
    }
    const parts = path.split('/').filter((p) => p.length > 0)
    let current = path.startsWith('/') ? '' : '.'
    for (const part of parts) {
      current = current === '' || current === '.' ? `${current === '' ? '' : current}/${part}`.replace(/^\.\//, '') : `${current}/${part}`
      try {
        await sftp.mkdir(current)
      } catch {
        // уже существует или создался параллельно — проверять каждый уровень дорого
      }
    }
  }

  async rm(path: string): Promise<void> {
    const sftp = await sftpPromises(this.sftp())
    let isDir: boolean
    try {
      const st = await sftp.stat(path)
      isDir = st.isDirectory()
    } catch {
      throw Object.assign(new Error(`ENOENT: no such file: ${path}`), { code: 'ENOENT' })
    }
    if (!isDir) {
      await sftp.unlink(path)
      return
    }
    const items = await sftp.readdir(path)
    for (const item of items) {
      await this.rm(this.join(path, item.filename))
    }
    await sftp.rmdir(path)
  }

  async rename(from: string, to: string): Promise<void> {
    const sftp = await sftpPromises(this.sftp())
    await sftp.rename(from, to)
  }

  async stat(path: string): Promise<FsEntry | null> {
    try {
      const sftp = await sftpPromises(this.sftp())
      const st = await sftp.stat(path)
      return { name: this.basename(path), isDir: st.isDirectory(), size: Number(st.size ?? 0), mtimeMs: Number(st.mtime ?? 0) * 1000 }
    } catch {
      return null
    }
  }

  async exists(path: string): Promise<boolean> {
    return (await this.stat(path)) !== null
  }

  async readHead(path: string, maxBytes: number): Promise<string> {
    const sftp = await sftpPromises(this.sftp())
    const handle = await sftp.open(path, 'r')
    try {
      const buffer = Buffer.alloc(maxBytes)
      const { bytesRead } = await sftp.read(handle, buffer, 0, maxBytes, 0)
      return buffer.toString('utf8', 0, bytesRead)
    } finally {
      await sftp.close(handle)
    }
  }

  async *lines(path: string, maxBytes = 64 * 1024 * 1024): AsyncIterable<string> {
    // Файл читается целиком (SFTP без стриминга строк); maxBytes режет только разбор.
    const buffer = await this.readFile(path)
    const capped = buffer.length > maxBytes ? buffer.subarray(0, maxBytes) : buffer
    for (const line of capped.toString('utf8').split('\n')) {
      yield line.endsWith('\r') ? line.slice(0, -1) : line
    }
  }

  async createExclusive(path: string, data: Buffer | string): Promise<boolean> {
    try {
      const sftp = await sftpPromises(this.sftp())
      const handle = await sftp.open(path, 'wx')
      try {
        await sftp.write(handle, Buffer.from(data), 0, Buffer.byteLength(data), 0)
      } finally {
        await sftp.close(handle)
      }
      return true
    } catch {
      return false
    }
  }

  async renameOverwrite(from: string, to: string): Promise<void> {
    const sftp = await sftpPromises(this.sftp())
    // posix-rename@openssh.com перезаписывает цель атомарно; сервер без расширения — фолбэк.
    const ext = sftp as unknown as { ext_openssh_rename?: (src: string, dst: string) => Promise<void> }
    if (typeof ext.ext_openssh_rename === 'function') {
      try {
        await ext.ext_openssh_rename(from, to)
        return
      } catch {
        // расширения нет — обычный путь ниже
      }
    }
    try {
      await sftp.rename(from, to)
    } catch {
      // Стандартный rename не перезаписывает: снять цель и переименовать (окно без файла).
      await sftp.unlink(to).catch(() => {})
      await sftp.rename(from, to)
    }
  }
}

export const hostProjectFs: HostProjectFs = new HostProjectFs()

/** ФС проекта: ssh — SFTP сервера проекта, native/wsl — локальный fs (UNC читается напрямую). */
export function getProjectFs(project: ProjectEntry, settings: Settings): ProjectFs {
  if (project.kind !== 'ssh') return hostProjectFs
  const server = settings.sshServers.find((s) => s.id === project.serverId)
  if (server === undefined) {
    throw new Error('SSH server for this project is missing. Check settings.')
  }
  const ssh = getSshService()
  return new SshProjectFs(() => ssh.sftp(server))
}

/** Домашний каталог бэкенда проекта: Windows homedir (native), $HOME дистрибутива (wsl),
 *  $HOME сервера (ssh). POSIX-путь для wsl/ssh, Windows-путь для native. */
export async function resolveBackendHome(project: ProjectEntry, settings: Settings): Promise<string | null> {
  if (project.kind === 'native') return homedir()
  if (project.kind === 'wsl') {
    const distro = settings.wslDistro.trim() || (await listWslDistros())[0]
    if (distro === undefined) return null
    return resolveWslHome(distro)
  }
  const server = settings.sshServers.find((s) => s.id === project.serverId)
  if (server === undefined) return null
  const ssh = getSshService()
  return ssh.homeDir(server)
}
