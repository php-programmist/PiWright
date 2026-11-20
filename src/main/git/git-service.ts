/** GitService: git CLI на стороне бэкенда проекта. native — spawn git с cwd проекта;
 *  wsl — `wsl.exe -d <distro> --cd <wslCwd> --exec bash -lic 'git …'` (порт схемы спавна
 *  `exec/WslShell.kt`). Сообщение коммита генерирует одноразовый `PiConnection` с
 *  `--no-session` (файл сессии не создаётся, история не засоряется). */
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import type {
  GitBranchesResult,
  GitFileDiffResult,
  GitLogResult,
  GitMessageResult,
  GitOpResult,
  GitStatusResult,
  ProjectEntry,
  Settings
} from '../../shared/ipc-contracts'
import { PiConnection } from '../pi/connection'
import { obj, str } from '../pi/event-translator'
import { createPiBackend } from '../pi/backends/factory'
import { buildBashCommand, buildWslSpawnArgs } from '../pi/backends/shell'
import { listWslDistros, wslPathFor } from '../pi/backends/wsl'
import { buildCommitPrompt, cleanCommitMessage } from './commit-message'
import { parseLogOneline, parseStatusOutput } from './porcelain'

const GIT_TIMEOUT_MS = 30_000
const PUSH_TIMEOUT_MS = 120_000
const GEN_TIMEOUT_MS = 240_000
const LOG_LIMIT = 20
const BINARY_PLACEHOLDER = '(binary file)'

interface ExecResult {
  code: number
  stdout: string
  stderr: string
}

function errorOf(result: ExecResult, args: string[]): string {
  const stderr = result.stderr.trim()
  if (stderr.length > 0) return stderr.split('\n').slice(-10).join('\n')
  const stdout = result.stdout.trim()
  if (stdout.length > 0) return stdout.split('\n').slice(-10).join('\n')
  return `git ${args[0] ?? ''} exited with code ${result.code}`
}

const OK: GitOpResult = { ok: true, error: null }

export class GitService {
  constructor(private readonly getSettings: () => Settings) {}

  /** Прогон git на стороне бэкенда: native — прямой spawn, wsl — bash -lic внутри дистрибутива. */
  private async exec(project: ProjectEntry, args: string[], timeoutMs: number): Promise<ExecResult> {
    const settings = this.getSettings()
    let child: ChildProcess
    if (project.kind === 'native') {
      child = spawn('git', args, { cwd: project.dir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } else {
      const distro = settings.wslDistro.trim() || (await listWslDistros())[0]
      if (distro === undefined) throw new Error('No WSL distro available. Set it in settings.')
      const wslCwd = await wslPathFor(distro, project.dir)
      child = spawn('wsl.exe', buildWslSpawnArgs(distro, wslCwd, buildBashCommand('git', args)), {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      })
    }
    return await new Promise<ExecResult>((resolve, reject) => {
      let stdout = ''
      let stderr = ''
      let settled = false
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true
          reject(new Error(`git ${args[0] ?? ''} timed out after ${Math.round(timeoutMs / 1000)}s`))
          child.kill()
        }
      }, timeoutMs)
      timer.unref()
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        stdout += chunk
      })
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (chunk: string) => {
        stderr += chunk
      })
      child.on('error', (err: Error) => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          reject(err)
        }
      })
      child.on('close', (code) => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          resolve({ code: code ?? -1, stdout, stderr })
        }
      })
    })
  }

  private async run(project: ProjectEntry, args: string[], timeoutMs = GIT_TIMEOUT_MS): Promise<ExecResult> {
    try {
      return await this.exec(project, args, timeoutMs)
    } catch (err) {
      return { code: -1, stdout: '', stderr: err instanceof Error ? err.message : String(err) }
    }
  }

  async status(project: ProjectEntry): Promise<GitStatusResult> {
    const result = await this.run(project, ['status', '--porcelain=v2', '--branch'])
    if (result.code !== 0) return { ok: false, error: errorOf(result, ['status']), status: null }
    return { ok: true, error: null, status: parseStatusOutput(result.stdout) }
  }

  /** Содержимое HEAD-версии файла; untracked/новых файлов в HEAD нет — пусто. */
  async headFile(project: ProjectEntry, path: string): Promise<string> {
    const result = await this.run(project, ['show', `HEAD:${path}`])
    return result.code === 0 ? result.stdout : ''
  }

  /** Файл на диске (хост-путь: Windows-каталог или UNC WSL); удалён — пусто. */
  private async diskFile(project: ProjectEntry, path: string): Promise<string> {
    try {
      return await readFile(join(project.dir, ...path.split('/')), 'utf8')
    } catch {
      return ''
    }
  }

  async fileDiff(project: ProjectEntry, path: string): Promise<GitFileDiffResult> {
    const status = await this.status(project)
    if (!status.ok || status.status === null) return { ok: false, error: status.error, original: '', modified: '' }
    const entry = status.status.entries.find((e) => e.path === path)
    const original = entry !== undefined && (entry.untracked || entry.index === 'A') ? '' : await this.headFile(project, path)
    const modified = await this.diskFile(project, path)
    const clean = (text: string): string => (text.includes('\0') ? BINARY_PLACEHOLDER : text)
    return { ok: true, error: null, original: clean(original), modified: clean(modified) }
  }

  async stage(project: ProjectEntry, paths: string[]): Promise<GitOpResult> {
    if (paths.length === 0) return { ok: false, error: 'No files to stage' }
    const result = await this.run(project, ['add', '--', ...paths])
    return result.code === 0 ? OK : { ok: false, error: errorOf(result, ['add']) }
  }

  async unstage(project: ProjectEntry, paths: string[]): Promise<GitOpResult> {
    if (paths.length === 0) return { ok: false, error: 'No files to unstage' }
    const result = await this.run(project, ['restore', '--staged', '--', ...paths])
    return result.code === 0 ? OK : { ok: false, error: errorOf(result, ['restore']) }
  }

  async commit(project: ProjectEntry, message: string): Promise<GitOpResult> {
    const result = await this.run(project, ['commit', '-m', message])
    return result.code === 0 ? OK : { ok: false, error: errorOf(result, ['commit']) }
  }

  async push(project: ProjectEntry): Promise<GitOpResult> {
    const upstream = await this.run(project, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
    const args = upstream.code === 0 ? ['push'] : ['push', '-u', 'origin', 'HEAD']
    const result = await this.run(project, args, PUSH_TIMEOUT_MS)
    return result.code === 0 ? OK : { ok: false, error: errorOf(result, args) }
  }

  async log(project: ProjectEntry): Promise<GitLogResult> {
    const result = await this.run(project, ['log', '--oneline', '-n', String(LOG_LIMIT)])
    if (result.code !== 0) return { ok: true, error: null, entries: [] }
    return { ok: true, error: null, entries: parseLogOneline(result.stdout) }
  }

  async branches(project: ProjectEntry): Promise<GitBranchesResult> {
    const result = await this.run(project, ['branch', '--list', '--format=%(refname:short)'])
    if (result.code !== 0) return { ok: false, error: errorOf(result, ['branch']), branches: [] }
    const branches = result.stdout.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
    return { ok: true, error: null, branches }
  }

  async checkout(project: ProjectEntry, name: string, create: boolean): Promise<GitOpResult> {
    const trimmed = name.trim()
    if (trimmed.length === 0 || /\s/.test(trimmed)) return { ok: false, error: 'Invalid branch name' }
    const args = create ? ['checkout', '-b', trimmed] : ['checkout', trimmed]
    const result = await this.run(project, args)
    return result.code === 0 ? OK : { ok: false, error: errorOf(result, args) }
  }

  /** Сообщение коммита: `git diff --staged` → промпт → одноразовый pi (RPC, без сессии и
   *  расширений) → текст ответа. Ход завершается по `agent_settled`. */
  async generateCommitMessage(project: ProjectEntry): Promise<GitMessageResult> {
    const diff = await this.run(project, ['diff', '--staged'])
    if (diff.code !== 0) return { ok: false, error: errorOf(diff, ['diff']), message: '' }
    if (diff.stdout.trim().length === 0) return { ok: false, error: 'No staged changes', message: '' }

    const created = await createPiBackend(project, this.getSettings())
    if (created.backend === null) return { ok: false, error: created.error, message: '' }

    return await new Promise<GitMessageResult>((resolve) => {
      let text = ''
      let done = false
      let timer: NodeJS.Timeout | null = null
      const finish = (result: GitMessageResult): void => {
        if (done) return
        done = true
        if (timer !== null) clearTimeout(timer)
        conn.close()
        resolve(result)
      }
      const conn = new PiConnection(created.backend!.spawner, {
        onEvent: (type, payload) => {
          if (type === 'message_update') {
            const event = obj(payload, 'assistantMessageEvent')
            if (str(event, 'type') === 'text_delta') text += str(event, 'delta') ?? ''
            return
          }
          if (type === 'agent_settled') {
            const message = cleanCommitMessage(text)
            finish(
              message.length > 0
                ? { ok: true, error: null, message }
                : { ok: false, error: 'Model returned an empty message', message: '' }
            )
          }
        },
        onExtensionUiRequest: () => {},
        onDisconnected: (cause, exitCode, stderrTail) =>
          finish({ ok: false, error: `pi exited (code ${exitCode ?? '?'}). stderr: ${stderrTail || cause || '—'}`, message: '' })
      })
      timer = setTimeout(() => finish({ ok: false, error: 'Commit message generation timed out', message: '' }), GEN_TIMEOUT_MS)
      timer.unref()
      void (async () => {
        try {
          const args = ['--mode', 'rpc', '--no-session', '--no-extensions', '--no-tools', '--no-mcp']
          await conn.start({ cwd: project.dir, args })
          await conn.request('get_state')
          const response = await conn.request('prompt', { message: buildCommitPrompt(diff.stdout) })
          if (!response.success) finish({ ok: false, error: `prompt failed: ${response.error ?? 'no details'}`, message: '' })
        } catch (err) {
          finish({ ok: false, error: err instanceof Error ? err.message : String(err), message: '' })
        }
      })()
    })
  }
}
