import { describe, expect, it } from 'vitest'
import { resolveChatLink } from '../src/shared/file-paths'

describe('resolveChatLink', () => {
  it('relative path', () => {
    expect(resolveChatLink('D:\\Projects\\foo', 'spec/versions/v0.2.0.md')).toEqual({
      kind: 'file',
      path: 'spec/versions/v0.2.0.md'
    })
  })

  it('strips ./ prefix and anchor', () => {
    expect(resolveChatLink('D:\\Projects\\foo', './docs/guide.md#section-2')).toEqual({
      kind: 'file',
      path: 'docs/guide.md'
    })
  })

  it('absolute path inside project', () => {
    expect(resolveChatLink('D:\\Projects\\foo', 'D:\\Projects\\foo\\src\\a.ts')).toEqual({
      kind: 'file',
      path: 'src/a.ts'
    })
  })

  it('file:// url', () => {
    expect(resolveChatLink('D:\\Projects\\foo', 'file:///D:/Projects/foo/readme.md')).toEqual({
      kind: 'file',
      path: 'readme.md'
    })
  })

  it('percent-encoded path', () => {
    expect(resolveChatLink('D:\\Projects\\foo', 'docs/my%20file.md')).toEqual({
      kind: 'file',
      path: 'docs/my file.md'
    })
  })

  it('external urls', () => {
    expect(resolveChatLink('D:\\Projects\\foo', 'https://example.com')).toEqual({
      kind: 'external',
      url: 'https://example.com'
    })
    expect(resolveChatLink('D:\\Projects\\foo', 'mailto:a@b.c')).toEqual({
      kind: 'external',
      url: 'mailto:a@b.c'
    })
  })

  it('windows drive is a path, not a scheme', () => {
    expect(resolveChatLink('D:\\Projects\\foo', 'D:/Projects/foo/x.md')).toEqual({
      kind: 'file',
      path: 'x.md'
    })
  })

  it('unknown scheme and outside-project paths are null', () => {
    expect(resolveChatLink('D:\\Projects\\foo', 'javascript:alert(1)')).toBeNull()
    expect(resolveChatLink('D:\\Projects\\foo', 'D:\\Other\\a.ts')).toBeNull()
    expect(resolveChatLink('D:\\Projects\\foo', '#anchor')).toBeNull()
    expect(resolveChatLink('D:\\Projects\\foo', '')).toBeNull()
  })
})
