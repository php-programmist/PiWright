/** Settings → Models: providers/models из models.json бэкенда, табы Windows/WSL, копирование
 *  между бэкендами, открытие файла в редакторе. Референс — скрины DeepSeek Harness (features №21). */
import { useEffect, useState } from 'react'
import { cloneModel, cloneProvider, parseModelsDoc, serializeModelsDoc } from '../../../../shared/models-doc'
import type { ModelEdit, ParsedModelsDoc, ProviderEdit } from '../../../../shared/models-doc'
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
          context window
          <input value={model.contextWindow} placeholder="131072" onChange={(e) => onChange({ ...model, contextWindow: e.target.value })} />
        </label>
        <label>
          max output tokens
          <input value={model.maxTokens} placeholder="16384" onChange={(e) => onChange({ ...model, maxTokens: e.target.value })} />
        </label>
      </div>
      <div className="form-row">
        <span>input:</span>
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
        <span>thinking levels:</span>
        {model.thinkingLevelMap.length === 0 && <span className="panel-hint">none</span>}
      </div>
      {model.thinkingLevelMap.map((entry, index) => (
        <div key={index} className="level-row">
          <input list="model-levels" value={entry.level} placeholder="level" onChange={(e) => setLevel(index, { level: e.target.value })} />
          <input value={entry.value} placeholder="API value (empty = null)" onChange={(e) => setLevel(index, { value: e.target.value })} />
          <button
            className="icon remove"
            title="Remove level"
            onClick={() => onChange({ ...model, thinkingLevelMap: model.thinkingLevelMap.filter((_, i) => i !== index) })}
          >
            ×
          </button>
        </div>
      ))}
      <button className="ghost" onClick={() => onChange({ ...model, thinkingLevelMap: [...model.thinkingLevelMap, { level: '', value: '' }] })}>
        + Add level
      </button>
      <label>
        extra parameters (JSON)
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
  return (
    <div className="model-row">
      <div className="model-row-head">
        <input className="model-id" value={model.id} placeholder="model id" onChange={(e) => onChange({ ...model, id: e.target.value })} />
        <input
          className="model-name"
          value={model.name}
          placeholder="display name"
          onChange={(e) => onChange({ ...model, name: e.target.value })}
        />
        <button className="icon" title={open ? 'Collapse' : 'Expand'} onClick={() => setOpen(!open)}>
          {open ? '▾' : '▸'}
        </button>
        <button className="icon" title="Copy to another backend" onClick={onCopy}>
          ⇉
        </button>
        <button className="icon remove" title="Remove model" onClick={onDelete}>
          ×
        </button>
      </div>
      {open && <ModelForm model={model} onChange={onChange} />}
    </div>
  )
}

function ProviderForm({ draft, isNew, error, onChange, onApply, onCancel, onCopyModel }: ProviderFormProps): React.JSX.Element {
  const setModel = (index: number, next: ModelEdit): void => {
    onChange({ ...draft, models: draft.models.map((m, i) => (i === index ? next : m)) })
  }
  return (
    <div className="provider-form">
      <label>
        name
        <input value={draft.name} disabled={!isNew} onChange={(e) => onChange({ ...draft, name: e.target.value })} />
      </label>
      <label>
        API key
        <input value={draft.apiKey} placeholder="key or $ENV_VAR" onChange={(e) => onChange({ ...draft, apiKey: e.target.value })} />
      </label>
      <label>
        base URL
        <input value={draft.baseUrl} placeholder="https://…/v1" onChange={(e) => onChange({ ...draft, baseUrl: e.target.value })} />
      </label>
      <label>
        API protocol
        <input list="api-hints" value={draft.api} placeholder="openai-completions" onChange={(e) => onChange({ ...draft, api: e.target.value })} />
        <datalist id="api-hints">
          {API_HINTS.map((api) => (
            <option key={api} value={api} />
          ))}
        </datalist>
      </label>
      <div className="form-row">
        <span>models</span>
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
        + Add model
      </button>
      {error !== null && <div className="settings-error">{error}</div>}
      <div className="form-actions">
        <button onClick={onCancel}>Cancel</button>
        <button className="primary" onClick={onApply}>
          Apply
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
  return (
    <div className="copy-panel">
      <div className="copy-title">
        Copy model <b>{props.modelId}</b> to {backendLabel(props.targetBackend)}
      </div>
      <label className="settings-check">
        <input type="checkbox" checked={props.isNew} onChange={(e) => props.onNew(e.target.checked)} />
        create new provider
      </label>
      {props.isNew ? (
        <>
          <label>
            provider name
            <input value={props.newName} onChange={(e) => props.onNewName(e.target.value)} />
          </label>
          <label>
            base URL
            <input value={props.newBaseUrl} placeholder="https://…/v1" onChange={(e) => props.onNewBaseUrl(e.target.value)} />
          </label>
          <label>
            API key
            <input value={props.newApiKey} onChange={(e) => props.onNewApiKey(e.target.value)} />
          </label>
        </>
      ) : (
        <label>
          target provider
          <select value={props.targetName} onChange={(e) => props.onTargetName(e.target.value)}>
            <option value="">— pick provider —</option>
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
        <button onClick={props.onCancel}>Cancel</button>
        <button className="primary" onClick={props.onConfirm}>
          Copy
        </button>
      </div>
    </div>
  )
}

export function ModelsTab(): React.JSX.Element {
  const [backend, setBackend] = useState<BackendMode>('native')
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
      setFormError('Provider name is empty')
      return
    }
    if (!editing.isNew && name !== editing.name && parsed.providers.some((p) => p.name === name)) {
      setFormError(`Provider '${name}' already exists`)
      return
    }
    if (editing.isNew && parsed.providers.some((p) => p.name === name)) {
      setFormError(`Provider '${name}' already exists`)
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
    if (!window.confirm(`Delete provider '${provider.name}' from ${backendLabel(backend)} models.json?`)) return
    const next: ParsedModelsDoc = { providers: parsed.providers.filter((p) => p.name !== provider.name), rest: parsed.rest }
    const err = await persist(next, backend)
    setNotice(err ?? `Deleted '${provider.name}'`)
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
    if (existing && !window.confirm(`Provider '${provider.name}' already exists on ${backendLabel(target)}. Overwrite?`)) return
    const clone = cloneProvider(provider, provider.name)
    const next: ParsedModelsDoc = {
      providers: existing
        ? targetDoc.providers.map((p) => (p.name === provider.name ? clone : p))
        : [...targetDoc.providers, clone],
      rest: targetDoc.rest
    }
    const err = await persist(next, target)
    setNotice(err ?? `Copied '${provider.name}' to ${backendLabel(target)}`)
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
      setCopyError('Pick a provider or enter a new name')
      return
    }
    let providers = [...copyState.target.providers]
    if (copyNew) {
      if (providers.some((p) => p.name === name)) {
        setCopyError(`Provider '${name}' already exists`)
        return
      }
      providers.push({ name, baseUrl: copyNewBaseUrl, api: 'openai-completions', apiKey: copyNewApiKey, models: [], extra: {} })
    }
    const index = providers.findIndex((p) => p.name === name)
    if (index === -1) {
      setCopyError('Provider not found')
      return
    }
    providers = providers.map((p, i) => (i === index ? { ...p, models: [...p.models, cloneModel(copyState.model)] } : p))
    const target = otherBackend(backend)
    const err = await persist({ providers, rest: copyState.target.rest }, target)
    setNotice(err ?? `Copied '${copyState.model.id}' to ${backendLabel(target)}`)
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
          Open models.json in editor
        </button>
      </div>
      <div className="models-file">
        {loading ? 'loading…' : `${file}${exists ? '' : ' (missing — will be created on save)'}`}
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
                    <span className={`models-dot ${provider.apiKey.trim().length > 0 ? 'ok' : 'missing'}`} title={provider.apiKey.trim().length > 0 ? 'API key set' : 'API key is empty'} />
                    <span className="provider-name">{provider.name}</span>
                    <span className="spacer" />
                    <button
                      className="ghost"
                      onClick={() => (editing === null ? startEdit(provider) : setNotice('Finish or cancel the current edit first'))}
                    >
                      Edit
                    </button>
                    <button className="ghost" onClick={() => void copyProviderTo(provider)}>
                      Copy → {backendLabel(otherBackend(backend))}
                    </button>
                    <button className="ghost danger" onClick={() => void deleteProvider(provider)}>
                      Delete
                    </button>
                  </div>
                  <div className="provider-meta">
                    {provider.baseUrl || '(no base URL)'} · {provider.api || '(no api)'} · {provider.models.length} model(s)
                  </div>
                </>
              )}
            </div>
          ))}
          <button className="add-provider" disabled={editing !== null} onClick={startAdd}>
            + Add provider
          </button>
        </div>
      )}
    </div>
  )
}
