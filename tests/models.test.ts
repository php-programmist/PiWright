import { describe, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cloneModel, cloneProvider, parseModelsDoc, serializeModelsDoc } from '../src/shared/models-doc'
import type { ProviderEdit } from '../src/shared/models-doc'
import { listModels, modelsFilePath, revealModelsFile, saveModels } from '../src/main/models/models-service'
import { DEFAULT_SETTINGS } from '../src/main/settings/settings'

vi.mock('electron', () => ({ shell: { openPath: async () => '' } }))

type SerializedDoc = { providers: Record<string, { models: Array<Record<string, unknown>> }> }

const SAMPLE = {
  providers: {
    p100: {
      baseUrl: 'https://voice-assistant.example/v1',
      api: 'openai-completions',
      apiKey: '$P100_API_KEY',
      models: [
        {
          id: 'p100/qwen3.8-flash-next',
          reasoning: true,
          thinkingLevelMap: { high: 'xhigh', off: null },
          input: ['text', 'image'],
          contextWindow: 131072,
          maxTokens: 16384,
          samplingParams: { temperature: 1.0, top_p: 0.95 }
        }
      ]
    },
    spark: {
      baseUrl: 'http://spark.example:48888/v1',
      api: 'openai-completions',
      apiKey: 'plain-key',
      models: [{ id: 'qwen3.8-flash-next', contextWindow: 262144, reasoning: true }]
    }
  }
}

describe('parseModelsDoc', () => {
  it('parses providers, models and moves unknown keys into extraText', () => {
    const parsed = parseModelsDoc(SAMPLE)
    expect(parsed.providers.map((p) => p.name)).toEqual(['p100', 'spark'])
    const p100 = parsed.providers[0]
    expect(p100.baseUrl).toBe('https://voice-assistant.example/v1')
    expect(p100.apiKey).toBe('$P100_API_KEY')
    const model = p100.models[0]
    expect(model.id).toBe('p100/qwen3.8-flash-next')
    expect(model.contextWindow).toBe('131072')
    expect(model.maxTokens).toBe('16384')
    expect(model.input).toEqual(['text', 'image'])
    expect(model.reasoning).toBe(true)
    expect(model.thinkingLevelMap).toEqual([
      { level: 'high', value: 'xhigh' },
      { level: 'off', value: '' }
    ])
    expect(JSON.parse(model.extraText)).toEqual({ samplingParams: { temperature: 1.0, top_p: 0.95 } })
    expect(parsed.rest).toEqual({})
  })

  it('keeps foreign top-level keys in rest and skips broken branches', () => {
    const parsed = parseModelsDoc({ providers: { bad: 'not-an-object', ok: { baseUrl: 'x' } }, futureKey: 1 })
    expect(parsed.providers.map((p) => p.name)).toEqual(['ok'])
    expect(parsed.rest).toEqual({ futureKey: 1 })
  })

  it('null and garbage input yield empty doc', () => {
    expect(parseModelsDoc(null).providers).toEqual([])
    expect(parseModelsDoc('nope').providers).toEqual([])
    expect(parseModelsDoc({ providers: [] }).providers).toEqual([])
  })
})

describe('serializeModelsDoc', () => {
  it('roundtrips the sample document', () => {
    const doc = serializeModelsDoc(parseModelsDoc(SAMPLE))
    expect(doc).toEqual(SAMPLE)
  })

  it('omits empty optional fields and writes empty level values as null', () => {
    const parsed = parseModelsDoc({ providers: {} })
    parsed.providers.push({
      name: 'p',
      baseUrl: '',
      api: '',
      apiKey: '',
      models: [
        {
          id: 'm1',
          name: '',
          contextWindow: '',
          maxTokens: '',
          input: [],
          reasoning: false,
          thinkingLevelMap: [{ level: 'low', value: '' }],
          extraText: ''
        }
      ],
      extra: {}
    })
    const doc = serializeModelsDoc(parsed) as SerializedDoc
    expect(doc.providers.p.models[0]).toEqual({ id: 'm1', thinkingLevelMap: { low: null } })
  })

  it('merges extraText back and throws on broken JSON', () => {
    const parsed = parseModelsDoc({ providers: {} })
    parsed.providers.push({ ...emptyProviderShaped(), models: [{ ...emptyModelShaped(), extraText: '{"samplingParams":{"temperature":0}}' }] })
    const doc = serializeModelsDoc(parsed) as SerializedDoc
    expect(doc.providers.p.models[0]['samplingParams']).toEqual({ temperature: 0 })
    parsed.providers[0].models[0].extraText = '{broken'
    expect(() => serializeModelsDoc(parsed)).toThrow()
  })

  it('keeps provider extra fields', () => {
    const parsed = parseModelsDoc({ providers: { p: { baseUrl: 'x', customFlag: true } } })
    const doc = serializeModelsDoc(parsed) as { providers: Record<string, Record<string, unknown>> }
    expect(doc.providers.p['customFlag']).toBe(true)
  })
})

describe('clone helpers', () => {
  it('cloneProvider renames and deep-copies models', () => {
    const parsed = parseModelsDoc(SAMPLE)
    const clone = cloneProvider(parsed.providers[0], 'p100-copy')
    clone.models[0].input.push('audio')
    clone.models[0].thinkingLevelMap[0].value = 'changed'
    expect(clone.name).toBe('p100-copy')
    expect(parsed.providers[0].models[0].input).toEqual(['text', 'image'])
    expect(parsed.providers[0].models[0].thinkingLevelMap[0].value).toBe('xhigh')
  })

  it('cloneModel deep-copies lists', () => {
    const parsed = parseModelsDoc(SAMPLE)
    const clone = cloneModel(parsed.providers[0].models[0])
    clone.input.push('audio')
    expect(parsed.providers[0].models[0].input).toEqual(['text', 'image'])
  })
})

describe('models service (native, tmp home)', () => {
  it('modelsFilePath joins home/.pi/agent/models.json', async () => {
    const path = await modelsFilePath('native', DEFAULT_SETTINGS, 'C:\\tmp-home')
    expect(path).toBe(join('C:\\tmp-home', '.pi', 'agent', 'models.json'))
  })

  it('save writes atomically, list reads back, invalid doc is rejected', async () => {
    const home = await fs.mkdtemp(join(tmpdir(), 'piwright-models-'))
    const saved = await saveModels('native', DEFAULT_SETTINGS, SAMPLE, home)
    expect(saved).toEqual({ ok: true, error: null })
    const list = await listModels('native', DEFAULT_SETTINGS, home)
    expect(list.ok).toBe(true)
    expect(list.exists).toBe(true)
    expect(list.doc).toEqual(SAMPLE)
    const bad = await saveModels('native', DEFAULT_SETTINGS, { providers: { p: 'nope' } }, home)
    expect(bad.ok).toBe(false)
    const missing = await listModels('native', DEFAULT_SETTINGS, await fs.mkdtemp(join(tmpdir(), 'piwright-models-')))
    expect(missing.exists).toBe(false)
    expect(missing.doc).toBeNull()
  })

  it('reveal creates a default file and reports the path', async () => {
    const home = await fs.mkdtemp(join(tmpdir(), 'piwright-models-'))
    const res = await revealModelsFile('native', DEFAULT_SETTINGS, home)
    expect(res.ok).toBe(true)
    const raw = JSON.parse(await fs.readFile(join(home, '.pi', 'agent', 'models.json'), 'utf8')) as unknown
    expect(raw).toEqual({ providers: {} })
  })
})

function emptyProviderShaped(): ProviderEdit {
  return { name: 'p', baseUrl: '', api: '', apiKey: '', models: [], extra: {} }
}

function emptyModelShaped() {
  return { id: 'm1', name: '', contextWindow: '', maxTokens: '', input: [], reasoning: false, thinkingLevelMap: [], extraText: '' }
}
