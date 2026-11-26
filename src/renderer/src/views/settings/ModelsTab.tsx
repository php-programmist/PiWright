/** Settings → Models: providers/models из models.json бэкенда, табы Windows/WSL, копирование
 *  между бэкендами, открытие файла в редакторе. Референс — скрины DeepSeek Harness (features №21). */
import { useEffect, useState } from 'react'
import { cloneModel, cloneProvider, parseModelsDoc, serializeModelsDoc } from '../../../../shared/models-doc'
import type { ModelEdit, ParsedModelsDoc, ProviderEdit } from '../../../../shared/models-doc'
import { useT } from '../../lib/i18n'
import { useSessionsStore } from '../../stores/sessions'
import { confirmDialog } from '../../components/ConfirmDialog'
import type { BackendMode } from '../../../../shared/ipc-contracts'

const API_HINTS = ['openai-completions', 'openai-responses', 'anthropic-messages']
const LEVEL_HINTS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const INPUT_KINDS = ['text', 'image']

/** Цель копирования: бэкенд (+ конкретный SSH-сервер) и его отображаемое имя. */
interface BackendRef {
  backend: BackendMode
  serverId?: string
  label: string
}

function backendLabel(backend: BackendMode): string {
  return backend === 'native' ? 'Windows' : backend === 'ssh' ? 'SSH' : 'WSL'
}

function emptyProvider(): ProviderEdit {
  return { name: '', baseUrl: '', api: 'openai-completions', apiKey: '', models: [], extra: {} }
}

function emptyModel(): ModelEdit {
  return { id: '', name: '', contextWindow: '', maxTokens: '', input: ['text'], reasoning: false, thinkingLevelMap: [], extraText: '' }
}

function CopyMenu({ targets, onPick, icon }: { targets: BackendRef[]; onPick: (target: BackendRef) => void; icon?: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const t = useT()
  return (
    <div className="menu-wrap">
      <button
        className={icon === true ? 'icon' : 'ghost'}
        title={icon === true ? t('Copy to another backend') : undefined}
        onClick={() => setOpen(!open)}
      >
        {icon === true ? '⇉' : t('Copy to…')}
      </button>
      {open && (
        <>
          <div className="popup-overlay" onClick={() => setOpen(false)} />
          <div className="project-menu">
            {targets.map((target) => (
              <button
                key={`${target.backend}:${target.serverId ?? ''}`}
                className="project-menu-item"
                onClick={() => {
                  setOpen(false)
                  onPick(target)
                }}
              >
                {target.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

interface ProviderFormProps {
  draft: ProviderEdit
  isNew: boolean
  error: string | null
  onChange: (next: ProviderEdit) => void
  onApply: () => void
  onCancel: () => void
  copyTargets: BackendRef[]
  onCopyModel: (model: ModelEdit, target: BackendRef) => void
}

function ModelForm({ model, onChange }: { model: ModelEdit; onChange: (next: ModelEdit) => void }): React.JSX.Element {
  const t = useT()
  const toggleInput = (kind: string): void => {
    onChange({
      ...model,
      input: model.input.includes(kind) ? model.input.filter((k) => k !== kind) : [...model.input, kind]
    })
  }
  const setLevel = (index: number, patch: Partial<{ level: string; value: string }>): void => {
    onChange({ ...model, thinkingLevelMap: model.thinkingLevelMap.map((e, i) => (i === index ? { ...e, ...patch } : e)) })
  }
  return (
    <div className="model-form">
      <div className="form-grid">
        <label>
          {t('Context window')}
          <input value={model.contextWindow} placeholder="131072" onChange={(e) => onChange({ ...model, contextWindow: e.target.value })} />
        </label>
        <label>
          {t('Max output tokens')}
          <input value={model.maxTokens} placeholder="16384" onChange={(e) => onChange({ ...model, maxTokens: e.target.value })} />
        </label>
      </div>
      <div className="form-row">
        <span>{t('Input:')}</span>
        {INPUT_KINDS.map((kind) => (
          <label key={kind} className="settings-check inline">
            <input type="checkbox" checked={model.input.includes(kind)} onChange={() => toggleInput(kind)} />
            {t(kind)}
          </label>
        ))}
        <label className="settings-check inline">
          <input type="checkbox" checked={model.reasoning} onChange={(e) => onChange({ ...model, reasoning: e.target.checked })} />
          reasoning
        </label>
      </div>
      <div className="form-row">
        <span>{t('Thinking levels:')}</span>
        {model.thinkingLevelMap.length === 0 && <span className="panel-hint">{t('None')}</span>}
      </div>
      {model.thinkingLevelMap.map((entry, index) => (
        <div key={index} className="level-row">
          <input list="model-levels" value={entry.level} placeholder={t('Level')} onChange={(e) => setLevel(index, { level: e.target.value })} />
          <input value={entry.value} placeholder={t('API value (empty = null)')} onChange={(e) => setLevel(index, { value: e.target.value })} />
          <button
            className="icon remove"
            title={t('Remove level')}
            onClick={() => onChange({ ...model, thinkingLevelMap: model.thinkingLevelMap.filter((_, i) => i !== index) })}
          >
            ×
          </button>
        </div>
      ))}
      <button className="ghost" onClick={() => onChange({ ...model, thinkingLevelMap: [...model.thinkingLevelMap, { level: '', value: '' }] })}>
        {t('+ Add level')}
      </button>
      <label>
        {t('Extra parameters (JSON)')}
        <textarea
          className="extra-json"
          rows={3}
          value={model.extraText}
          placeholder='{"samplingParams": {"temperature": 1.0}}'
          onChange={(e) => onChange({ ...model, extraText: e.target.value })}
        />
      </label>
      <datalist id="model-levels">
        {LEVEL_HINTS.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>
    </div>
  )
}

function ModelRow({
  model,
  onChange,
  onDelete,
  copyTargets,
  onCopyTarget
}: {
  model: ModelEdit
  onChange: (next: ModelEdit) => void
  onDelete: () => void
  copyTargets: BackendRef[]
  onCopyTarget: (model: ModelEdit, target: BackendRef) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const t = useT()
  return (
    <div className="model-row">
      <div className="model-row-head">
        <input className="model-id" value={model.id} placeholder={t('Model id')} onChange={(e) => onChange({ ...model, id: e.target.value })} />
        <input
          className="model-name"
          value={model.name}
          placeholder={t('Display name')}
          onChange={(e) => onChange({ ...model, name: e.target.value })}
        />
        <button className="icon" title={open ? t('Collapse') : t('Expand')} onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'}
        </button>
        <CopyMenu icon targets={copyTargets} onPick={(target) => onCopyTarget(model, target)} />
        <button className="icon remove" title={t('Remove model')} onClick={onDelete}>
          ×
        </button>
      </div>
      {open && <ModelForm model={model} onChange={onChange} />}
    </div>
  )
}

function ProviderForm({ draft, isNew, error, onChange, onApply, onCancel, copyTargets, onCopyModel }: ProviderFormProps): React.JSX.Element {
  const t = useT()
  const setModel = (index: number, next: ModelEdit): void => {
    onChange({ ...draft, models: draft.models.map((m, i) => (i === index ? next : m)) })
  }
  return (
    <div className="provider-form">
      <label>
        {t('Name')}
        <input value={draft.name} disabled={!isNew} onChange={(e) => onChange({ ...draft, name: e.target.value })} />
      </label>
      <label>
        {t('API key')}
        <input value={draft.apiKey} placeholder={t('Key or $ENV_VAR')} onChange={(e) => onChange({ ...draft, apiKey: e.target.value })} />
      </label>
      <label>
        {t('Base URL')}
        <input value={draft.baseUrl} placeholder="https://…/v1" onChange={(e) => onChange({ ...draft, baseUrl: e.target.value })} />
      </label>
      <label>
        {t('API protocol')}
        <input list="api-hints" value={draft.api} placeholder="openai-completions" onChange={(e) => onChange({ ...draft, api: e.target.value })} />
        <datalist id="api-hints">
          {API_HINTS.map((api) => (
            <option key={api} value={api} />
          ))}
        </datalist>
      </label>
      <div className="form-row">
        <span>{t('Models')}</span>
      </div>
      {draft.models.map((model, index) => (
        <ModelRow
          key={index}
          model={model}
          onChange={(next) => setModel(index, next)}
          onDelete={() => onChange({ ...draft, models: draft.models.filter((_, i) => i !== index) })}
          copyTargets={copyTargets}
          onCopyTarget={onCopyModel}
        />
      ))}
      <button className="ghost" onClick={() => onChange({ ...draft, models: [...draft.models, emptyModel()] })}>
        {t('+ Add model')}
      </button>
      {error !== null && <div className="settings-error">{error}</div>}
      <div className="form-actions">
        <button onClick={onCancel}>{t('Cancel')}</button>
        <button className="primary" onClick={onApply}>
          {t('Apply')}
        </button>
      </div>
    </div>
  )
}

interface CopyPanelProps {
  modelId: string
  targetLabel: string
  target: ParsedModelsDoc
  targetName: string
  isNew: boolean
  newName: string
  newBaseUrl: string
  newApiKey: string
  error: string | null
  onTargetName: (value: string) => void
  onNew: (value: boolean) => void
  onNewName: (value: string) => void
  onNewBaseUrl: (value: string) => void
  onNewApiKey: (value: string) => void
  onConfirm: () => void
  onCancel: () => void
}

function CopyPanel(props: CopyPanelProps): React.JSX.Element {
  const t = useT()
  return (
    <div className="copy-panel">
      <div className="copy-title">
        {t('Copy model {id} to {backend}', { id: props.modelId, backend: props.targetLabel })}
      </div>
      <label className="settings-check">
        <input type="checkbox" checked={props.isNew} onChange={(e) => props.onNew(e.target.checked)} />
        {t('Create new provider')}
      </label>
      {props.isNew ? (
        <>
          <label>
            {t('Provider name')}
            <input value={props.newName} onChange={(e) => props.onNewName(e.target.value)} />
          </label>
          <label>
            {t('Base URL')}
            <input value={props.newBaseUrl} placeholder="https://…/v1" onChange={(e) => props.onNewBaseUrl(e.target.value)} />
          </label>
          <label>
            {t('API key')}
            <input value={props.newApiKey} onChange={(e) => props.onNewApiKey(e.target.value)} />
          </label>
        </>
      ) : (
        <label>
          {t('Target provider')}
          <select value={props.targetName} onChange={(e) => props.onTargetName(e.target.value)}>
            <option value="">{t('— Pick provider —')}</option>
            {props.target.providers.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {props.error !== null && <div className="settings-error">{props.error}</div>}
      <div className="form-actions">
        <button onClick={props.onCancel}>{t('Cancel')}</button>
        <button className="primary" onClick={props.onConfirm}>
          {t('Copy')}
        </button>
      </div>
    </div>
  )
}

export function ModelsTab(): React.JSX.Element {
  const [backend, setBackend] = useState<BackendMode>('native')
  const settings = useSessionsStore((s) => s.settings)
  const sshServers = settings?.sshServers ?? []
  const [sshServerIdRaw, setSshServerId] = useState<string>('')
  // Сервер по умолчанию — производное состояние: невалидный id заменяется первым существующим.
  const sshServerId = sshServers.some((s) => s.id === sshServerIdRaw) ? sshServerIdRaw : (sshServers[0]?.id ?? '')
  const t = useT()
  const [loadedFor, setLoadedFor] = useState<BackendMode | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [file, setFile] = useState('')
  const [exists, setExists] = useState(false)
  const [parsed, setParsed] = useState<ParsedModelsDoc>({ providers: [], rest: {} })
  const [editing, setEditing] = useState<{ name: string; isNew: boolean } | null>(null)
  const [draft, setDraft] = useState<ProviderEdit | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [copyState, setCopyState] = useState<{ model: ModelEdit; target: ParsedModelsDoc; targetRef: BackendRef } | null>(null)
  const [jsonText, setJsonText] = useState<string | null>(null)
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [copyTargetName, setCopyTargetName] = useState('')
  const [copyNew, setCopyNew] = useState(false)
  const [copyNewName, setCopyNewName] = useState('')
  const [copyNewBaseUrl, setCopyNewBaseUrl] = useState('')
  const [copyNewApiKey, setCopyNewApiKey] = useState('')
  const [copyError, setCopyError] = useState<string | null>(null)

  const loading = loadedFor !== backend || (backend === 'ssh' && sshServerId.length === 0 && sshServers.length > 0)

  const copyTargets: BackendRef[] = [
    ...(backend !== 'native' ? [{ backend: 'native' as const, label: 'Windows' }] : []),
    ...(backend !== 'wsl' ? [{ backend: 'wsl' as const, label: 'WSL' }] : []),
    ...sshServers
      .filter((s) => !(backend === 'ssh' && s.id === sshServerId))
      .map((s) => ({ backend: 'ssh' as const, serverId: s.id, label: `SSH: ${s.name}` }))
  ]

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await window.piwright.modelsList(backend, backend === 'ssh' ? sshServerId : undefined)
      if (cancelled) return
      setLoadError(res.ok ? null : (res.error ?? t('load failed')))
      setFile(res.file)
      setExists(res.exists)
      setParsed(parseModelsDoc(res.ok ? res.doc : null))
      setEditing(null)
      setDraft(null)
      setFormError(null)
      setNotice(null)
      setCopyState(null)
      setJsonText(null)
      setJsonError(null)
      setLoadedFor(backend)
    })()
    return () => {
      cancelled = true
    }
  }, [backend, sshServerId, t])

  const persist = async (next: ParsedModelsDoc, target: BackendMode, targetServerId?: string): Promise<string | null> => {
    let doc: unknown
    try {
      doc = serializeModelsDoc(next)
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
    const res = await window.piwright.modelsSave(target, doc, target === 'ssh' ? targetServerId : undefined)
    if (res.ok) void window.piwright.modelsRefresh().catch(() => {})
    return res.ok ? null : (res.error ?? t('save failed'))
  }

  const startEdit = (provider: ProviderEdit): void => {
    setEditing({ name: provider.name, isNew: false })
    setDraft(cloneProvider(provider, provider.name))
    setFormError(null)
  }

  const startAdd = (): void => {
    setEditing({ name: '', isNew: true })
    setDraft(emptyProvider())
    setFormError(null)
  }

  const applyProvider = async (): Promise<void> => {
    if (draft === null || editing === null) return
    const name = draft.name.trim()
    if (name.length === 0) {
      setFormError(t('Provider name is empty'))
      return
    }
    if (!editing.isNew && name !== editing.name && parsed.providers.some((p) => p.name === name)) {
      setFormError(t('Provider {name} already exists', { name }))
      return
    }
    if (editing.isNew && parsed.providers.some((p) => p.name === name)) {
      setFormError(t('Provider {name} already exists', { name }))
      return
    }
    const next: ParsedModelsDoc = {
      providers: editing.isNew
        ? [...parsed.providers, { ...draft, name }]
        : parsed.providers.map((p) => (p.name === editing.name ? { ...draft, name } : p)),
      rest: parsed.rest
    }
    const err = await persist(next, backend, sshServerId)
    if (err !== null) {
      setFormError(err)
      return
    }
    setParsed(next)
    setEditing(null)
    setDraft(null)
    setFormError(null)
    setExists(true)
  }

  const deleteProvider = async (provider: ProviderEdit): Promise<void> => {
    if (!(await confirmDialog({ message: t('Delete provider {name} from {backend} models.json?', { name: provider.name, backend: backendLabel(backend) }), confirmLabel: t('Delete'), danger: true }))) return
    const next: ParsedModelsDoc = { providers: parsed.providers.filter((p) => p.name !== provider.name), rest: parsed.rest }
    const err = await persist(next, backend, sshServerId)
    setNotice(err ?? t('Deleted {name}', { name: provider.name }))
    if (err === null) setParsed(next)
  }

  const copyProviderTo = async (provider: ProviderEdit, targetRef: BackendRef): Promise<void> => {
    const res = await window.piwright.modelsList(targetRef.backend, targetRef.serverId)
    if (!res.ok) {
      setNotice(res.error ?? t('load failed'))
      return
    }
    const targetDoc = parseModelsDoc(res.doc)
    const existing = targetDoc.providers.some((p) => p.name === provider.name)
    if (existing && !(await confirmDialog({ message: t('Provider {name} already exists on {backend}. Overwrite?', { name: provider.name, backend: targetRef.label }), confirmLabel: t('Overwrite') }))) return
    const clone = cloneProvider(provider, provider.name)
    const next: ParsedModelsDoc = {
      providers: existing
        ? targetDoc.providers.map((p) => (p.name === provider.name ? clone : p))
        : [...targetDoc.providers, clone],
      rest: targetDoc.rest
    }
    const err = await persist(next, targetRef.backend, targetRef.serverId)
    setNotice(err ?? t('Copied {name} to {backend}', { name: provider.name, backend: targetRef.label }))
  }

  const openCopyModel = async (model: ModelEdit, targetRef: BackendRef): Promise<void> => {
    const res = await window.piwright.modelsList(targetRef.backend, targetRef.serverId)
    if (!res.ok) {
      setNotice(res.error ?? t('load failed'))
      return
    }
    const targetDoc = parseModelsDoc(res.doc)
    setCopyState({ model: cloneModel(model), target: targetDoc, targetRef })
    setCopyTargetName(targetDoc.providers[0]?.name ?? '')
    setCopyNew(targetDoc.providers.length === 0)
    setCopyNewName('')
    setCopyNewBaseUrl('')
    setCopyNewApiKey('')
    setCopyError(null)
  }

  const confirmCopyModel = async (): Promise<void> => {
    if (copyState === null) return
    const name = copyNew ? copyNewName.trim() : copyTargetName
    if (name.length === 0) {
      setCopyError(t('Pick a provider or enter a new name'))
      return
    }
    let providers = [...copyState.target.providers]
    if (copyNew) {
      if (providers.some((p) => p.name === name)) {
        setCopyError(t('Provider {name} already exists', { name }))
        return
      }
      providers.push({ name, baseUrl: copyNewBaseUrl, api: 'openai-completions', apiKey: copyNewApiKey, models: [], extra: {} })
    }
    const index = providers.findIndex((p) => p.name === name)
    if (index === -1) {
      setCopyError(t('Provider not found'))
      return
    }
    providers = providers.map((p, i) => (i === index ? { ...p, models: [...p.models, cloneModel(copyState.model)] } : p))
    const err = await persist({ providers, rest: copyState.target.rest }, copyState.targetRef.backend, copyState.targetRef.serverId)
    setNotice(err ?? t('Copied {name} to {backend}', { name: copyState.model.id, backend: copyState.targetRef.label }))
    if (err === null) setCopyState(null)
  }

  const reveal = async (): Promise<void> => {
    const res = await window.piwright.modelsReveal(backend, backend === 'ssh' ? sshServerId : undefined)
    if (!res.ok) setNotice(res.error ?? t('open failed'))
  }

  const openJsonEditor = (): void => {
    let doc: unknown
    try {
      doc = serializeModelsDoc(parsed)
    } catch {
      doc = { providers: {} }
    }
    setJsonText(JSON.stringify(doc, null, 2))
    setJsonError(null)
    setEditing(null)
    setDraft(null)
    setFormError(null)
    setCopyState(null)
  }

  const saveJson = async (): Promise<void> => {
    if (jsonText === null) return
    let doc: unknown
    try {
      doc = JSON.parse(jsonText)
    } catch (err) {
      setJsonError(`${t('Invalid JSON')}: ${err instanceof Error ? err.message : String(err)}`)
      return
    }
    const res = await window.piwright.modelsSave(backend, doc, backend === 'ssh' ? sshServerId : undefined)
    if (!res.ok) {
      setJsonError(res.error ?? t('save failed'))
      return
    }
    void window.piwright.modelsRefresh().catch(() => {})
    setParsed(parseModelsDoc(doc))
    setExists(true)
    setJsonText(null)
    setJsonError(null)
  }

  return (
    <div className="models-tab">
      <div className="models-head">
        <div className="backend-tabs">
          <button className={backend === 'native' ? 'current' : ''} onClick={() => setBackend('native')}>
            Windows
          </button>
          <button className={backend === 'wsl' ? 'current' : ''} onClick={() => setBackend('wsl')}>
            WSL
          </button>
          {sshServers.length > 0 && (
            <button className={backend === 'ssh' ? 'current' : ''} onClick={() => setBackend('ssh')}>
              SSH
            </button>
          )}
          {backend === 'ssh' && (
            <select value={sshServerId} onChange={(e) => setSshServerId(e.target.value)}>
              {sshServers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )}
        </div>
        <span className="spacer" />
        <button className="ghost" onClick={openJsonEditor}>
          {t('Edit JSON')}
        </button>
        {backend !== 'ssh' && (
          <button className="ghost" onClick={() => void reveal()}>
            {t('Open models.json in editor')}
          </button>
        )}
      </div>
      <div className="models-file">
        {loading ? t('loading…') : `${file}${exists ? '' : ` ${t('(missing — will be created on save)')}`}`}
      </div>
      {loadError !== null && <div className="settings-error">{loadError}</div>}
      {notice !== null && <div className="panel-hint">{notice}</div>}
      {!loading && jsonText === null && copyState !== null && (
        <CopyPanel
          modelId={copyState.model.id}
          targetLabel={copyState.targetRef.label}
          target={copyState.target}
          targetName={copyTargetName}
          isNew={copyNew}
          newName={copyNewName}
          newBaseUrl={copyNewBaseUrl}
          newApiKey={copyNewApiKey}
          error={copyError}
          onTargetName={setCopyTargetName}
          onNew={setCopyNew}
          onNewName={setCopyNewName}
          onNewBaseUrl={setCopyNewBaseUrl}
          onNewApiKey={setCopyNewApiKey}
          onConfirm={() => void confirmCopyModel()}
          onCancel={() => setCopyState(null)}
        />
      )}
      {!loading && jsonText === null && editing !== null && editing.isNew && draft !== null && (
        <div className="provider-list">
          <div className="provider-card">
            <ProviderForm
              draft={draft}
              isNew
              error={formError}
              onChange={setDraft}
              onApply={() => void applyProvider()}
              onCancel={() => {
                setEditing(null)
                setDraft(null)
                setFormError(null)
              }}
              onCopyModel={(model, target) => void openCopyModel(model, target)}
              copyTargets={copyTargets}
            />
          </div>
        </div>
      )}
      {!loading && jsonText === null && (
        <div className="provider-list">
          {parsed.providers.map((provider) => (
            <div key={provider.name} className="provider-card">
              {editing !== null && !editing.isNew && editing.name === provider.name && draft !== null ? (
                <ProviderForm
                  draft={draft}
                  isNew={false}
                  error={formError}
                  onChange={setDraft}
                  onApply={() => void applyProvider()}
                  onCancel={() => {
                    setEditing(null)
                    setDraft(null)
                    setFormError(null)
                  }}
                  onCopyModel={(model, target) => void openCopyModel(model, target)}
                  copyTargets={copyTargets}
                />
              ) : (
                <>
                  <div className="provider-head">
                    <span
                      className={`models-dot ${provider.apiKey.trim().length > 0 ? 'ok' : 'missing'}`}
                      title={provider.apiKey.trim().length > 0 ? t('API key set') : t('API key is empty')}
                    />
                    <span className="provider-name">{provider.name}</span>
                    <span className="spacer" />
                    <button
                      className="ghost"
                      onClick={() => (editing === null ? startEdit(provider) : setNotice(t('Finish or cancel the current edit first')))}
                    >
                      {t('Edit')}
                    </button>
                    <CopyMenu targets={copyTargets} onPick={(target) => void copyProviderTo(provider, target)} />
                    <button className="ghost danger" onClick={() => void deleteProvider(provider)}>
                      {t('Delete')}
                    </button>
                  </div>
                  <div className="provider-meta">
                    {provider.baseUrl || t('(no base URL)')} · {provider.api || t('(no api)')} ·{' '}
                    {t('{count} model(s)', { count: provider.models.length })}
                  </div>
                </>
              )}
            </div>
          ))}
          <button className="add-provider" disabled={editing !== null} onClick={startAdd}>
            {t('+ Add provider')}
          </button>
        </div>
      )}
      {!loading && jsonText !== null && (
        <div className="models-json-editor">
          <textarea
            className="json-editor-text"
            spellCheck={false}
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
          />
          {jsonError !== null && <div className="settings-error">{jsonError}</div>}
          <div className="form-actions">
            <button
              onClick={() => {
                setJsonText(null)
                setJsonError(null)
              }}
            >
              {t('Cancel')}
            </button>
            <button className="primary" onClick={() => void saveJson()}>
              {t('Save')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
