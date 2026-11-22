/** Settings → Models: providers/models из models.json бэкенда, табы Windows/WSL, копирование
 *  между бэкендами, открытие файла в редакторе. Референс — скрины DeepSeek Harness (features №21). */
import { useEffect, useState } from 'react'
import { cloneModel, cloneProvider, parseModelsDoc, serializeModelsDoc } from '../../../../shared/models-doc'
import type { ModelEdit, ParsedModelsDoc, ProviderEdit } from '../../../../shared/models-doc'
import { useT } from '../../lib/i18n'
import { confirmDialog } from '../../components/ConfirmDialog'
import type { BackendMode } from '../../../../shared/ipc-contracts'

const API_HINTS = ['openai-completions', 'openai-responses', 'anthropic-messages']
const LEVEL_HINTS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
const INPUT_KINDS = ['text', 'image']

function otherBackend(backend: BackendMode): BackendMode {
  return backend === 'native' ? 'wsl' : 'native'
}

function backendLabel(backend: BackendMode): string {
  return backend === 'native' ? 'Windows' : 'WSL'
}

function emptyProvider(): ProviderEdit {
  return { name: '', baseUrl: '', api: 'openai-completions', apiKey: '', models: [], extra: {} }
}

function emptyModel(): ModelEdit {
  return { id: '', name: '', contextWindow: '', maxTokens: '', input: ['text'], reasoning: false, thinkingLevelMap: [], extraText: '' }
}

interface ProviderFormProps {
  draft: ProviderEdit
  isNew: boolean
  error: string | null
  onChange: (next: ProviderEdit) => void
  onApply: () => void
  onCancel: () => void
  onCopyModel: (model: ModelEdit) => void
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
            {kind}
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
  onCopy
}: {
  model: ModelEdit
  onChange: (next: ModelEdit) => void
  onDelete: () => void
  onCopy: () => void
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
        <button className="icon" title={t('Copy to another backend')} onClick={onCopy}>
          ⇉
        </button>
        <button className="icon remove" title={t('Remove model')} onClick={onDelete}>
          ×
        </button>
      </div>
      {open && <ModelForm model={model} onChange={onChange} />}
    </div>
  )
}

function ProviderForm({ draft, isNew, error, onChange, onApply, onCancel, onCopyModel }: ProviderFormProps): React.JSX.Element {
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
          onCopy={() => onCopyModel(model)}
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
  targetBackend: BackendMode
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
        {t('Copy model {id} to {backend}', { id: props.modelId, backend: backendLabel(props.targetBackend) })}
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
  const [copyState, setCopyState] = useState<{ model: ModelEdit; target: ParsedModelsDoc } | null>(null)
  const [copyTargetName, setCopyTargetName] = useState('')
  const [copyNew, setCopyNew] = useState(false)
  const [copyNewName, setCopyNewName] = useState('')
  const [copyNewBaseUrl, setCopyNewBaseUrl] = useState('')
  const [copyNewApiKey, setCopyNewApiKey] = useState('')
  const [copyError, setCopyError] = useState<string | null>(null)

  const loading = loadedFor !== backend

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await window.piwright.modelsList(backend)
      if (cancelled) return
      setLoadError(res.ok ? null : (res.error ?? 'load failed'))
      setFile(res.file)
      setExists(res.exists)
      setParsed(parseModelsDoc(res.ok ? res.doc : null))
      setEditing(null)
      setDraft(null)
      setFormError(null)
      setNotice(null)
      setCopyState(null)
      setLoadedFor(backend)
    })()
    return () => {
      cancelled = true
    }
  }, [backend])

  const persist = async (next: ParsedModelsDoc, target: BackendMode): Promise<string | null> => {
    let doc: unknown
    try {
      doc = serializeModelsDoc(next)
    } catch (err) {
      return err instanceof Error ? err.message : String(err)
    }
    const res = await window.piwright.modelsSave(target, doc)
    return res.ok ? null : (res.error ?? 'save failed')
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
    const err = await persist(next, backend)
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
    const err = await persist(next, backend)
    setNotice(err ?? t('Deleted {name}', { name: provider.name }))
    if (err === null) setParsed(next)
  }

  const copyProviderTo = async (provider: ProviderEdit): Promise<void> => {
    const target = otherBackend(backend)
    const res = await window.piwright.modelsList(target)
    if (!res.ok) {
      setNotice(res.error ?? 'load failed')
      return
    }
    const targetDoc = parseModelsDoc(res.doc)
    const existing = targetDoc.providers.some((p) => p.name === provider.name)
    if (existing && !(await confirmDialog({ message: t('Provider {name} already exists on {backend}. Overwrite?', { name: provider.name, backend: backendLabel(target) }), confirmLabel: t('Overwrite') }))) return
    const clone = cloneProvider(provider, provider.name)
    const next: ParsedModelsDoc = {
      providers: existing
        ? targetDoc.providers.map((p) => (p.name === provider.name ? clone : p))
        : [...targetDoc.providers, clone],
      rest: targetDoc.rest
    }
    const err = await persist(next, target)
    setNotice(err ?? t('Copied {name} to {backend}', { name: provider.name, backend: backendLabel(target) }))
  }

  const openCopyModel = async (model: ModelEdit): Promise<void> => {
    const target = otherBackend(backend)
    const res = await window.piwright.modelsList(target)
    if (!res.ok) {
      setNotice(res.error ?? 'load failed')
      return
    }
    const targetDoc = parseModelsDoc(res.doc)
    setCopyState({ model: cloneModel(model), target: targetDoc })
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
    const target = otherBackend(backend)
    const err = await persist({ providers, rest: copyState.target.rest }, target)
    setNotice(err ?? t('Copied {name} to {backend}', { name: copyState.model.id, backend: backendLabel(target) }))
    if (err === null) setCopyState(null)
  }

  const reveal = async (): Promise<void> => {
    const res = await window.piwright.modelsReveal(backend)
    if (!res.ok) setNotice(res.error ?? 'open failed')
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
        </div>
        <span className="spacer" />
        <button className="ghost" onClick={() => void reveal()}>
          {t('Open models.json in editor')}
        </button>
      </div>
      <div className="models-file">
        {loading ? t('loading…') : `${file}${exists ? '' : ` ${t('(missing — will be created on save)')}`}`}
      </div>
      {loadError !== null && <div className="settings-error">{loadError}</div>}
      {notice !== null && <div className="panel-hint">{notice}</div>}
      {!loading && copyState !== null && (
        <CopyPanel
          modelId={copyState.model.id}
          targetBackend={otherBackend(backend)}
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
      {!loading && editing !== null && editing.isNew && draft !== null && (
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
              onCopyModel={(model) => void openCopyModel(model)}
            />
          </div>
        </div>
      )}
      {!loading && (
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
                  onCopyModel={(model) => void openCopyModel(model)}
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
                    <button className="ghost" onClick={() => void copyProviderTo(provider)}>
                      {t('Copy → {backend}', { backend: backendLabel(otherBackend(backend)) })}
                    </button>
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
    </div>
  )
}
