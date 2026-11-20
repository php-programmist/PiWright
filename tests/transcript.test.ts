/** Транскрипт исторической сессии без pi: реплей сообщений JSONL → UiEvent-ы. */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readSessionMessages, readSessionTranscript, replaySessionEvents } from '../src/main/sessions/transcript'

const USER = '{"type":"message","id":"m1","message":{"role":"user","content":[{"type":"text","text":"do it"}]}}'
const ASSISTANT =
  '{"type":"message","id":"m2","message":{"role":"assistant","content":[{"type":"thinking","thinking":"hmm"},{"type":"text","text":"ok"},{"type":"toolCall","id":"t1","name":"read","arguments":{"path":"a"}}]}}'
const TOOL_RESULT =
  '{"type":"message","id":"m3","message":{"role":"toolResult","toolCallId":"t1","toolName":"read","content":[{"type":"text","text":"data"}],"isError":false}}'
const NOISE = '{"type":"model_change","id":"x","provider":"p","modelId":"m"}'
const CUSTOM = '{"type":"custom_message","customType":"caveman-rules","content":"rawr"}'

describe('replaySessionEvents', () => {
  it('user/assistant/toolResult → лента с вложенным тулом и thinking', () => {
    const events = replaySessionEvents([
      JSON.parse(USER).message,
      JSON.parse(ASSISTANT).message,
      JSON.parse(TOOL_RESULT).message
    ])
    expect(events.map((e) => e.type)).toEqual([
      'injected_user_message',
      'thought_delta',
      'assistant_delta',
      'tool_start',
      'tool_end'
    ])
    const toolEnd = events[4]
    expect(toolEnd.type === 'tool_end' && toolEnd.call.id === 't1' && toolEnd.result.text === 'data').toBe(true)
  })

  it('compactionSummary → compaction_end, мусор игнорируется', () => {
    const events = replaySessionEvents([{ role: 'compactionSummary', tokensBefore: 100 }, 'junk', null])
    expect(events.map((e) => e.type)).toEqual(['compaction_end'])
  })
})

describe('readSessionMessages / readSessionTranscript', () => {
  let dir: string
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'piwright-tr-'))
  })
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('читает только type:"message" по порядку, битые строки пропускает', async () => {
    const file = join(dir, 's.jsonl')
    writeFileSync(
      file,
      ['{"type":"session","id":"s1","cwd":"/p"}', NOISE, USER, 'not json', CUSTOM, ASSISTANT, TOOL_RESULT, ''].join('\n'),
      'utf8'
    )
    const messages = await readSessionMessages(file)
    expect(messages).toHaveLength(3)
    const events = await readSessionTranscript(file)
    expect(events[0].type).toBe('injected_user_message')
    expect(events[events.length - 1].type).toBe('tool_end')
  })

  it('пустой/битый файл → пустая лента', async () => {
    const file = join(dir, 'empty.jsonl')
    writeFileSync(file, '', 'utf8')
    expect(await readSessionTranscript(file)).toEqual([])
  })
})
