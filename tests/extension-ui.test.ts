import { describe, expect, it } from 'vitest'
import { decodeAskQuestionRequest, decodeExtensionDialog, encodeDialogAnswer, splitDialogTitleBody, stripAnsi } from '../src/main/pi/extension-ui'
import { ASK_PAYLOAD_PREFIX } from '../src/shared/ask-questions'
import type { PiJsonObject } from '../src/shared/protocol-types'

/** Порт ExtensionUiTest.kt (диалоговая часть) + PiSessionTest на splitDialogTitleBody + AskQuestionTest на decode. */

function obj(json: string): PiJsonObject {
  return JSON.parse(json) as PiJsonObject
}

function askTitle(questions: unknown): string {
  return ASK_PAYLOAD_PREFIX + Buffer.from(JSON.stringify({ questions }), 'utf8').toString('base64')
}

describe('extension-ui dialogs', () => {
  it('confirm decodes message and timeout', () => {
    expect(decodeExtensionDialog('confirm', obj('{"title":"Run?","message":"rm -rf","timeout":5000}'))).toEqual({
      kind: 'confirm',
      title: 'Run?',
      message: 'rm -rf',
      timeoutMs: 5000
    })
    expect(decodeExtensionDialog('confirm', obj('{"title":"Run?"}'))).toEqual({
      kind: 'confirm',
      title: 'Run?',
      message: null,
      timeoutMs: null
    })
  })

  it('select splits title into header and body, keeps options', () => {
    expect(
      decodeExtensionDialog('select', obj('{"title":"Pick one\\nSecond line is the body","options":["a","b"]}'))
    ).toEqual({
      kind: 'select',
      title: 'Pick one',
      body: 'Second line is the body',
      options: ['a', 'b'],
      timeoutMs: null
    })
    expect(decodeExtensionDialog('select', obj('{"title":"Just header","options":[]}'))).toEqual({
      kind: 'select',
      title: 'Just header',
      body: null,
      options: [],
      timeoutMs: null
    })
  })

  it('input and editor decode, dialogs are not fire-and-forget methods', () => {
    expect(decodeExtensionDialog('input', obj('{"title":"Name?","placeholder":"type here"}'))).toEqual({
      kind: 'input',
      title: 'Name?',
      placeholder: 'type here',
      timeoutMs: null
    })
    expect(decodeExtensionDialog('editor', obj('{"title":"Edit","prefill":"draft"}'))).toEqual({
      kind: 'editor',
      title: 'Edit',
      prefill: 'draft',
      timeoutMs: null
    })
    expect(decodeExtensionDialog('notify', obj('{"message":"hi"}'))).toBeNull()
    expect(decodeExtensionDialog('setStatus', obj('{"statusKey":"k"}'))).toBeNull()
    expect(decodeExtensionDialog('unknown', obj('{}'))).toBeNull()
  })

  it('input with the ask payload prefix decodes into an ask dialog', () => {
    const title = askTitle([
      {
        header: 'Auth method',
        question: 'Which auth?',
        multiSelect: true,
        options: [
          { label: 'A', description: 'first', preview: 'pa', recommendedReason: 'why' },
          { label: 'B' },
          { noLabel: true }
        ]
      },
      { question: '  ', options: [{ label: 'x' }] },
      'garbage'
    ])
    expect(decodeExtensionDialog('input', obj(JSON.stringify({ title, timeout: 1000 })))).toEqual({
      kind: 'ask',
      timeoutMs: 1000,
      request: {
        questions: [
          {
            header: 'Auth method',
            question: 'Which auth?',
            multiSelect: true,
            options: [
              { label: 'A', description: 'first', preview: 'pa', recommendedReason: 'why' },
              { label: 'B', description: '', preview: null, recommendedReason: null }
            ]
          }
        ]
      }
    })
  })

  it('ask payload garbage falls back to a plain input dialog', () => {
    expect(decodeAskQuestionRequest(ASK_PAYLOAD_PREFIX)).toBeNull()
    expect(decodeAskQuestionRequest(ASK_PAYLOAD_PREFIX + '!!!not-base64-json!!!')).toBeNull()
    expect(decodeAskQuestionRequest(ASK_PAYLOAD_PREFIX + Buffer.from('[]', 'utf8').toString('base64'))).toBeNull()
    expect(
      decodeAskQuestionRequest(ASK_PAYLOAD_PREFIX + Buffer.from(JSON.stringify({ questions: [] }), 'utf8').toString('base64'))
    ).toBeNull()
    expect(decodeAskQuestionRequest('plain title')).toBeNull()
  })

  it('answers encode to protocol fields', () => {
    expect(encodeDialogAnswer({ kind: 'confirmed', confirmed: true })).toEqual({ confirmed: true })
    expect(encodeDialogAnswer({ kind: 'value', value: 'x' })).toEqual({ value: 'x' })
    expect(encodeDialogAnswer({ kind: 'cancelled' })).toEqual({ cancelled: true })
  })

  it('splitDialogTitleBody', () => {
    expect(splitDialogTitleBody('one line')).toEqual(['one line', ''])
    expect(splitDialogTitleBody('head\nbody\nmore')).toEqual(['head', 'body\nmore'])
  })

  it('stripAnsi removes CSI sequences', () => {
    expect(stripAnsi('\u001b[38;5;226m⏸ plan\u001b[39m')).toBe('⏸ plan')
    expect(stripAnsi('plain')).toBe('plain')
  })
})
