import { describe, expect, it } from 'vitest'
import { resolveMarkdownImage } from '../src/shared/file-paths'

describe('resolveMarkdownImage', () => {
  it('resolves relative src against the md file directory', () => {
    expect(resolveMarkdownImage('D:\\Projects\\foo', 'docs', 'shots/a.png')).toEqual('docs/shots/a.png')
    expect(resolveMarkdownImage('D:\\Projects\\foo', 'docs', './shots/a.png')).toEqual('docs/shots/a.png')
  })

  it('resolves src in project root when md file is in root', () => {
    expect(resolveMarkdownImage('D:\\Projects\\foo', '', 'img.png')).toEqual('img.png')
    expect(resolveMarkdownImage('D:\\Projects\\foo', '', './.pi/attachments/x.png')).toEqual('.pi/attachments/x.png')
  })

  it('resolves parent segments and rejects escaping the project root', () => {
    expect(resolveMarkdownImage('D:\\Projects\\foo', 'docs/sub', '../img.png')).toEqual('docs/img.png')
    expect(resolveMarkdownImage('D:\\Projects\\foo', 'docs', '../../outside.png')).toBeNull()
  })

  it('resolves absolute paths inside the project against the project root', () => {
    expect(resolveMarkdownImage('D:\\Projects\\foo', 'docs', 'D:\\Projects\\foo\\assets\\a.png')).toEqual('assets/a.png')
    expect(resolveMarkdownImage('D:\\Projects\\foo', 'docs', '/assets/a.png')).toEqual('assets/a.png')
    expect(resolveMarkdownImage('D:\\Projects\\foo', 'docs', 'D:\\Other\\a.png')).toBeNull()
  })

  it('strips file:// prefix', () => {
    expect(resolveMarkdownImage('D:\\Projects\\foo', '', 'file:///D:/Projects/foo/a.png')).toEqual('a.png')
  })

  it('decodes percent-encoded names', () => {
    expect(resolveMarkdownImage('D:\\Projects\\foo', 'docs', 'my%20file.png')).toEqual('docs/my file.png')
  })

  it('strips fragments', () => {
    expect(resolveMarkdownImage('D:\\Projects\\foo', '', 'a.png#section')).toEqual('a.png')
  })

  it('passes data: urls through as null (rendered as-is)', () => {
    expect(resolveMarkdownImage('D:\\Projects\\foo', '', 'data:image/png;base64,AAA')).toBeNull()
  })

  it('rejects external schemes', () => {
    expect(resolveMarkdownImage('D:\\Projects\\foo', '', 'https://example.com/a.png')).toBeNull()
    expect(resolveMarkdownImage('D:\\Projects\\foo', '', 'javascript:alert(1)')).toBeNull()
  })

  it('rejects empty src', () => {
    expect(resolveMarkdownImage('D:\\Projects\\foo', '', '')).toBeNull()
    expect(resolveMarkdownImage('D:\\Projects\\foo', '', '  ')).toBeNull()
  })
})
