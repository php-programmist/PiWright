/** MCP-серверы проекта: табы Пользователь (mcp.json бэкенда) / Проект (.pi/mcp.json),
 *  карточки серверов с тогглом и живой проверкой, форма добавления/редактирования, импорт JSON. */
import { useEffect, useState } from 'react'
import { useSessionsStore } from '../../stores/sessions'
import { useT } from '../../lib/i18n'
import type { McpScope, McpServerEntry } from '../../../../shared/ipc-contracts'

type Exposure = 'codemode' | 'deferred' | 'direct' | 'hidden'

const EXPOSURE_VALUES: Exposure[] = ['codemode', 'deferred', 'direct', 'hidden']

function useExposures(): { value: Exposure; label: string; hint: string }[] {
  const t = useT()
  return [
    { value: 'codemode', label: 'CodeMode', hint: t('default — tools run through code mode') },
    { value: 'deferred', label: 'Deferred', hint: t('loaded via tool search when the model needs them') },
    { value: 'direct', label: 'Direct', hint: t('declared up front like a built-in tool') },
    { value: 'hidden', label: 'Hidden', hint: t('registered but not available to the model') }
  ]
}

interface ServerDraft {
  name: string
  transport: 'stdio' | 'http'
  command: string
  argsText: string
  envText: string
  cwd: string
  url: string
  headersText: string
  exposure: Exposure
  timeout: string
  description: string
}

function emptyDraft(): ServerDraft {
  return {
    name: '',
    transport: 'stdio',
    command: '',
    argsText: '',
    envText: '',
    cwd: '',
    url: '',
    headersText: '',
    exposure: 'codemode',
    timeout: '',
    description: ''
  }
}

function draftOf(entry: McpServerEntry): ServerDraft {
  const c = entry.config
  const lines = (value: unknown): string =>
    typeof value === 'string' ? value : Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').join('\n') : ''
  const mapLines = (value: unknown): string => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return ''
    return Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => typeof v === 'string')
      .map(([k, v]) => `${k}=${v as string}`)
      .join('\n')
  }
  const exposure =
    typeof c['exposure'] === 'string' && EXPOSURE_VALUES.includes(c['exposure'] as Exposure) ? (c['exposure'] as Exposure) : 'codemode'
  return {
    name: entry.name,
    transport: typeof c['url'] === 'string' && c['url'].length > 0 ? 'http' : 'stdio',
    command: typeof c['command'] === 'string' ? c['command'] : '',
    argsText: lines(c['args']),
    envText: mapLines(c['env']),
    cwd: typeof c['cwd'] === 'string' ? c['cwd'] : '',
    url: typeof c['url'] === 'string' ? c['url'] : '',
    headersText: mapLines(c['headers']),
    exposure,
    timeout: typeof c['timeout'] === 'number' ? String(c['timeout']) : '',
    description: typeof c['description'] === 'string' ? c['description'] : ''
  }
}

function configOf(draft: ServerDraft, enabled: boolean): Record<string, unknown> {
  const config: Record<string, unknown> = {}
  if (draft.transport === 'stdio') {
    config['command'] = draft.command
    const args = draft.argsText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
    if (args.length > 0) config['args'] = args
    const env = mapOf(draft.envText)
    if (env !== null) config['env'] = env
    if (draft.cwd.trim().length > 0) config['cwd'] = draft.cwd.trim()
  } else {
    config['url'] = draft.url
    const headers = mapOf(draft.headersText)
    if (headers !== null) config['headers'] = headers
  }
  if (draft.exposure !== 'codemode') config['exposure'] = draft.exposure
  const timeout = Number(draft.timeout)
  if (draft.timeout.trim().length > 0 && Number.isFinite(timeout) && timeout > 0) config['timeout'] = timeout
  if (draft.description.trim().length > 0) config['description'] = draft.description.trim()
  if (!enabled) config['enabled'] = false
  return config
}

function mapOf(text: string): Record<string, string> | null {
  const entries = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => {
      const eq = l.indexOf('=')
      return eq > 0 ? ([l.slice(0, eq).trim(), l.slice(eq + 1).trim()] as const) : null
    })
    .filter((p): p is readonly [string, string] => p !== null)
  return entries.length > 0 ? Object.fromEntries(entries) : null
}

interface ProbeState {
  status: 'idle' | 'checking' | 'done'
  toolCount: number
  error: string | null
  serverError: string | null
}

export function McpView(): React.JSX.Element {
  const activeHostId = useSessionsStore((s) => s.activeHostId)
  const project = useSessionsStore((s) => s.active.find((r) => r.hostId === s.activeHostId)?.project ?? null)
  const t = useT()
  const exposures = useExposures()
  const [scope, setScope] = useState<McpScope>('user')
  const [file, setFile] = useState('')
  const [exists, setExists] = useState(false)
  const [servers, setServers] = useState<McpServerEntry[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<ServerDraft | null>(null)
  const [editingOriginal, setEditingOriginal] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importError, setImportError] = useState<string | null>(null)
  const [probes, setProbes] = useState<Record<string, ProbeState>>({})

  const reload = async (p: typeof project, s: McpScope): Promise<void> => {
    if (p === null) return
    const res = await window.piwright.mcpList(p, s)
    setFile(res.file)
    setExists(res.exists)
    setServers(res.ok ? res.servers : [])
    setLoadError(res.ok ? null : res.error)
  }
  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (project === null) return
      const res = await window.piwright.mcpList(project, scope)
      if (cancelled) return
      setFile(res.file)
      setExists(res.exists)
      setServers(res.ok ? res.servers : [])
      setLoadError(res.ok ? null : res.error)
      setProbes({})
      setEditing(null)
      setEditingOriginal(null)
      setImportOpen(false)
    })()
    return () => {
      cancelled = true
    }
  }, [project, scope])

  const save = async (next: McpServerEntry[]): Promise<void> => {
    if (project === null) return
    const res = await window.piwright.mcpSave(project, scope, next)
    if (!res.ok) {
      setLoadError(res.error)
      return
    }
    await reload(project, scope)
  }

  const toggleEnabled = async (name: string): Promise<void> => {
    const next = servers.map((s) =>
      s.name === name ? { ...s, config: { ...s.config, enabled: s.config['enabled'] === false } } : s
    )
    await save(next)
  }

  const remove = async (name: string): Promise<void> => {
    await save(servers.filter((s) => s.name !== name))
  }

  const submitDraft = async (): Promise<void> => {
    if (editing === null) return
    const name = editing.name.trim()
    if (!/^[A-Za-z0-9_-]+$/.test(name)) {
      setImportError(t('Name: latin letters, digits, - and _ only'))
      return
    }
    if (editing.transport === 'stdio' && editing.command.trim().length === 0) {
      setImportError(t('Command is required'))
      return
    }
    if (editing.transport === 'http' && editing.url.trim().length === 0) {
      setImportError(t('URL is required'))
      return
    }
    const withoutOriginal = servers.filter((s) => s.name !== (editingOriginal ?? name))
    const next = [...withoutOriginal, { name, config: configOf(editing, true) }]
    setImportError(null)
    setEditing(null)
    setEditingOriginal(null)
    await save(next)
  }

  const runImport = async (): Promise<void> => {
    let parsed: unknown
    try {
      parsed = JSON.parse(importText)
    } catch {
      setImportError(t('Invalid JSON'))
      return
    }
    const map =
      parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)['mcpServers'] ?? parsed
        : null
    if (map === null || typeof map !== 'object' || Array.isArray(map)) {
      setImportError(t('Expected an object with mcpServers'))
      return
    }
    const imported: McpServerEntry[] = Object.entries(map as Record<string, unknown>)
      .filter(([, config]) => config !== null && typeof config === 'object' && !Array.isArray(config))
      .map(([name, config]) => ({ name, config: config as Record<string, unknown> }))
    if (imported.length === 0) {
      setImportError(t('No servers found in JSON'))
      return
    }
    const byName = new Map(servers.map((s) => [s.name, s]))
    for (const entry of imported) byName.set(entry.name, entry)
    setImportError(null)
    setImportOpen(false)
    setImportText('')
    await save([...byName.values()])
  }

  const probe = async (name: string): Promise<void> => {
    if (project === null) return
    setProbes((prev) => ({ ...prev, [name]: { status: 'checking', toolCount: 0, error: null, serverError: null } }))
    const res = await window.piwright.mcpProbe(project, scope, name)
    setProbes((prev) => ({
      ...prev,
      [name]: { status: 'done', toolCount: res.toolCount, error: res.error, serverError: res.serverError }
    }))
  }

  if (project === null || activeHostId === null) {
    return (
      <main className="center-view">
        <div className="panel-hint">{t('Pick a session — MCP servers are per-project.')}</div>
      </main>
    )
  }

  return (
    <main className="center-view">
      <header className="center-head">
        <h2>{t('MCP servers')}</h2>
        <span className="spacer" />
        <button className="ghost" onClick={() => void window.piwright.mcpReveal(project, scope)}>
          {t('Open file')}
        </button>
        <button className="ghost" onClick={() => setImportOpen((v) => !v)}>
          {t('Import JSON')}
        </button>
        <button onClick={() => setEditing(emptyDraft())}>{t('+ Add server')}</button>
      </header>
      <div className="center-tabs">
        <button className={scope === 'user' ? 'current' : ''} onClick={() => setScope('user')}>
          {t('User — all projects')}
        </button>
        <button className={scope === 'project' ? 'current' : ''} onClick={() => setScope('project')}>
          {t('Project — .pi/mcp.json')}
        </button>
      </div>
      <div className="panel-hint">
        {file.length > 0 ? (exists ? file : t('{file} (not created yet)', { file })) : (loadError ?? '')} — {t('applied to new chats; busy chats pick it up after a restart of the session.')}
      </div>
      {importOpen && (
        <section className="center-form">
          <h3>{t('Import JSON with mcpServers')}</h3>
          <textarea
            rows={6}
            value={importText}
            placeholder={'{\n  "mcpServers": {\n    "context7": { "url": "https://…" }\n  }\n}'}
            onChange={(e) => setImportText(e.target.value)}
          />
          {importError !== null && <div className="settings-error">{importError}</div>}
          <div className="settings-row">
            <button onClick={() => void runImport()} disabled={importText.trim().length === 0}>
              {t('Import')}
            </button>
            <button
              className="ghost"
              onClick={() => {
                setImportOpen(false)
                setImportText('')
                setImportError(null)
              }}
            >
              {t('Cancel')}
            </button>
          </div>
        </section>
      )}
      {editing !== null && (
        <section className="center-form">
          <h3>{editingOriginal === null ? t('Add MCP server') : t('Edit {name}', { name: editingOriginal })}</h3>
          <label>
            {t('name')}
            <input
              value={editing.name}
              placeholder={t('latin letters, digits, - and _')}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
            />
          </label>
          <label>
            {t('transport')}
            <select
              value={editing.transport}
              onChange={(e) => setEditing({ ...editing, transport: e.target.value as 'stdio' | 'http' })}
            >
              <option value="stdio">command (stdio)</option>
              <option value="http">URL (http)</option>
            </select>
          </label>
          {editing.transport === 'stdio' ? (
            <>
              <label>
                {t('command')}
                <input value={editing.command} placeholder="npx" onChange={(e) => setEditing({ ...editing, command: e.target.value })} />
              </label>
              <label>
                {t('args (one per line)')}
                <textarea
                  rows={2}
                  value={editing.argsText}
                  placeholder={'-y\n@modelcontextprotocol/server-filesystem .'}
                  onChange={(e) => setEditing({ ...editing, argsText: e.target.value })}
                />
              </label>
              <label>
                {t('env (NAME=value, one per line)')}
                <textarea rows={2} value={editing.envText} onChange={(e) => setEditing({ ...editing, envText: e.target.value })} />
              </label>
              <label>
                {t('cwd (relative or ~/…)')}
                <input value={editing.cwd} onChange={(e) => setEditing({ ...editing, cwd: e.target.value })} />
              </label>
            </>
          ) : (
            <>
              <label>
                url
                <input value={editing.url} placeholder="https://example.com/mcp" onChange={(e) => setEditing({ ...editing, url: e.target.value })} />
              </label>
              <label>
                {t('headers (Name=value, one per line)')}
                <textarea
                  rows={2}
                  value={editing.headersText}
                  placeholder="Authorization=Bearer ${TOKEN}"
                  onChange={(e) => setEditing({ ...editing, headersText: e.target.value })}
                />
              </label>
            </>
          )}
          <label>
            exposure
            <select value={editing.exposure} onChange={(e) => setEditing({ ...editing, exposure: e.target.value as Exposure })}>
              {exposures.map((e) => (
                <option key={e.value} value={e.value}>
                  {e.label} — {e.hint}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t('timeout, seconds')}
            <input
              type="number"
              value={editing.timeout}
              placeholder="60"
              onChange={(e) => setEditing({ ...editing, timeout: e.target.value })}
            />
          </label>
          <label>
            {t('description')}
            <input value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
          </label>
          {importError !== null && <div className="settings-error">{importError}</div>}
          <div className="settings-row">
            <button onClick={() => void submitDraft()}>{t('Save server')}</button>
            <button
              className="ghost"
              onClick={() => {
                setEditing(null)
                setEditingOriginal(null)
                setImportError(null)
              }}
            >
              {t('Cancel')}
            </button>
          </div>
        </section>
      )}
      {servers.length === 0 ? (
        <div className="panel-hint">{t('No MCP servers yet.')}</div>
      ) : (
        <div className="server-list">
          {servers.map((entry) => {
            const enabled = entry.config['enabled'] !== false
            const url = typeof entry.config['url'] === 'string' && entry.config['url'].length > 0
            const exposure = typeof entry.config['exposure'] === 'string' ? (entry.config['exposure'] as string) : 'codemode'
            const probeState = probes[entry.name]
            return (
              <div key={entry.name} className={`server-card${enabled ? '' : ' off'}`}>
                <div className="server-row">
                  <span className="server-name">{entry.name}</span>
                  <span className="badge">{url ? 'HTTP' : 'stdio'}</span>
                  <span className="badge">{exposure}</span>
                  <span className="spacer" />
                  <button
                    className="ghost"
                    title={t('Check connection')}
                    onClick={() => void probe(entry.name)}
                    disabled={probeState?.status === 'checking'}
                  >
                    {probeState?.status === 'checking' ? '…' : t('Check')}
                  </button>
                  <button
                    className="ghost"
                    onClick={() => {
                      setEditing(draftOf(entry))
                      setEditingOriginal(entry.name)
                      setImportError(null)
                    }}
                  >
                    {t('Edit')}
                  </button>
                  <button className="ghost" title={t('Remove server')} onClick={() => void remove(entry.name)}>
                    ×
                  </button>
                  <label className="switch">
                    <input type="checkbox" checked={enabled} onChange={() => void toggleEnabled(entry.name)} />
                    <span />
                  </label>
                </div>
                {probeState?.status === 'done' && (
                  <div className={probeState.error !== null ? 'server-status error' : 'server-status ok'}>
                    {probeState.error !== null
                      ? t('error: {error}', {
                          error: `${probeState.error}${probeState.serverError !== null ? ` — ${probeState.serverError}` : ''}`
                        })
                      : t('connected · {count} tool(s)', { count: probeState.toolCount })}
                  </div>
                )}
                {typeof entry.config['description'] === 'string' && entry.config['description'].length > 0 && (
                  <div className="server-desc">{entry.config['description'] as string}</div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </main>
  )
}
