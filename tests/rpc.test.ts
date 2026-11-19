import { describe, expect, it } from 'vitest'
import { encodeCommand, encodeExtensionUiResponse, parseInbound } from '../src/main/pi/rpc'

describe('encodeCommand', () => {
  it('is one line with id, type and copied fields', () => {
    const line = encodeCommand('7', 'prompt', { message: 'a\nb' })
    expect(line).not.toContain('\n')
    const obj = JSON.parse(line)
    expect(obj['id']).toBe('7')
    expect(obj['type']).toBe('prompt')
    expect(obj['message']).toBe('a\nb')
  })
})

describe('encodeExtensionUiResponse', () => {
  it('carries type, id and answer fields', () => {
    const obj = JSON.parse(encodeExtensionUiResponse('uuid-1', { confirmed: true }))
    expect(obj['type']).toBe('extension_ui_response')
    expect(obj['id']).toBe('uuid-1')
    expect(obj['confirmed']).toBe(true)
  })
})

describe('parseInbound', () => {
  it('parses a successful response with data', () => {
    const msg = parseInbound('{"id":"1","type":"response","command":"get_state","success":true,"data":{"isStreaming":false}}')
    expect(msg?.kind).toBe('response')
    if (msg?.kind !== 'response') return
    expect(msg.response.id).toBe('1')
    expect(msg.response.command).toBe('get_state')
    expect(msg.response.success).toBe(true)
    expect((msg.response.data as Record<string, unknown>)['isStreaming']).toBe(false)
    expect(msg.response.error).toBeNull()
  })

  it('parses a failed response with string error', () => {
    const msg = parseInbound('{"id":"3","type":"response","command":"set_model","success":false,"error":"Model not found: x"}')
    expect(msg?.kind).toBe('response')
    if (msg?.kind !== 'response') return
    expect(msg.response.success).toBe(false)
    expect(msg.response.error).toBe('Model not found: x')
  })

  it('parse error response has no id', () => {
    const msg = parseInbound('{"type":"response","command":"parse","success":false,"error":"bad json"}')
    expect(msg?.kind).toBe('response')
    if (msg?.kind !== 'response') return
    expect(msg.response.id).toBeNull()
    expect(msg.response.command).toBe('parse')
  })

  it('parses an extension ui request', () => {
    const msg = parseInbound('{"type":"extension_ui_request","id":"u1","method":"confirm","title":"Run?","message":"rm -rf"}')
    expect(msg?.kind).toBe('extensionUiRequest')
    if (msg?.kind !== 'extensionUiRequest') return
    expect(msg.id).toBe('u1')
    expect(msg.method).toBe('confirm')
    expect(msg.payload['message']).toBe('rm -rf')
  })

  it('any other type is an event', () => {
    const msg = parseInbound('{"type":"agent_settled"}')
    expect(msg?.kind).toBe('event')
    if (msg?.kind !== 'event') return
    expect(msg.type).toBe('agent_settled')
  })

  it('line separators inside json strings survive', () => {
    const msg = parseInbound('{"type":"message_update","text":"a b c"}')
    expect(msg?.kind).toBe('event')
    if (msg?.kind !== 'event') return
    expect(msg.payload['text']).toBe('a b c')
  })

  it('garbage, non-objects and missing type are null', () => {
    expect(parseInbound('not json')).toBeNull()
    expect(parseInbound('[1,2]')).toBeNull()
    expect(parseInbound('{"id":"1"}')).toBeNull()
  })
})
