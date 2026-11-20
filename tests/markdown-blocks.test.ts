import { describe, expect, it } from 'vitest'
import { joinMarkdownDoc, splitMarkdownDoc } from '../src/shared/markdown-blocks'

const LOSSLESS_FIXTURES = [
  'hello world',
  'para one\n\npara two',
  '# Title\n\ntext\n\n## Sub\n\nmore',
  '---\ntitle: x\n---\n\nbody text\n',
  'lead blanks\n\n\n\nafter\n\n\n',
  '```js\nconst a = 1\n```\n\nafter code',
  '```js\nunclosed fence\nwith lines',
  '- item 1\n- item 2\n\n- item 3 after blank\n\ntail para',
  '1. first\n2. second\n   continued\n\nplain',
  '> quote line\n> more\n\n> second para\n\nafter',
  '| a | b |\n|---|---|\n| 1 | 2 |\n\nafter table',
  'text with\nhard wrap\ncontinues here\n\nnext',
  '\n\nstarts with blanks\n',
  'only blanks\n\n\n',
  '',
  '---\r\ntitle: x\r\n---\r\n\r\nwindows body\r\n',
  'crlf para\r\n\r\nsecond\r\n'
]

describe('splitMarkdownDoc/joinMarkdownDoc', () => {
  for (const fixture of LOSSLESS_FIXTURES) {
    it(`lossless roundtrip: ${JSON.stringify(fixture.slice(0, 40))}`, () => {
      expect(joinMarkdownDoc(splitMarkdownDoc(fixture))).toBe(fixture)
    })
  }

  it('splits paragraphs on blank lines', () => {
    const doc = splitMarkdownDoc('one two\nthree\n\nfour')
    expect(doc.blocks).toEqual(['one two\nthree\n', 'four'])
    expect(doc.seps).toEqual(['\n'])
  })

  it('keeps a fenced block as one piece including fences', () => {
    const doc = splitMarkdownDoc('before\n\n```py\nx = 1\ny = 2\n```\n\nafter')
    expect(doc.blocks).toEqual(['before\n', '```py\nx = 1\ny = 2\n```\n', 'after'])
  })

  it('unclosed fence runs to end of file', () => {
    const doc = splitMarkdownDoc('```js\na\nb')
    expect(doc.blocks).toEqual(['```js\na\nb'])
  })

  it('heading is its own block', () => {
    const doc = splitMarkdownDoc('# Head\ntext below')
    expect(doc.blocks).toEqual(['# Head\n', 'text below'])
  })

  it('list keeps items together across blank lines', () => {
    const doc = splitMarkdownDoc('- a\n- b\n\n- c\n\npara')
    expect(doc.blocks).toEqual(['- a\n- b\n\n- c\n', 'para'])
  })

  it('quote keeps lazy paragraphs together', () => {
    const doc = splitMarkdownDoc('> q1\n\n> q2\n\nafter')
    expect(doc.blocks).toEqual(['> q1\n\n> q2\n', 'after'])
  })

  it('table rows stay together', () => {
    const doc = splitMarkdownDoc('| a | b |\n|---|---|\n| 1 | 2 |\n\nx')
    expect(doc.blocks[0]).toBe('| a | b |\n|---|---|\n| 1 | 2 |\n')
  })

  it('detects front matter and separates it from blocks', () => {
    const doc = splitMarkdownDoc('---\nname: x\n---\n\nbody')
    expect(doc.frontMatter).toBe('---\nname: x\n---\n')
    expect(doc.blocks).toEqual(['body'])
  })

  it('unclosed front matter is not front matter', () => {
    const doc = splitMarkdownDoc('---\njust text')
    expect(doc.frontMatter).toBe(null)
  })

  it('leading blanks go to lead, trailing to tail', () => {
    const doc = splitMarkdownDoc('\n\n\nblock\n\n\n')
    expect(doc.lead).toBe('\n\n\n')
    expect(doc.blocks).toEqual(['block\n'])
    expect(doc.tail).toBe('\n\n')
  })

  it('empty text produces empty doc', () => {
    const doc = splitMarkdownDoc('')
    expect(doc.blocks).toEqual([])
    expect(joinMarkdownDoc(doc)).toBe('')
  })

  it('editing one block preserves the rest byte-for-byte', () => {
    const source = '---\ntitle: t\n---\n\nfirst\n\n```js\nkeep()\n```\n\n- x\n- y\n'
    const doc = splitMarkdownDoc(source)
    const blocks = [...doc.blocks]
    blocks[0] = 'changed\n'
    expect(joinMarkdownDoc({ ...doc, blocks })).toBe(source.replace('first', 'changed'))
  })
})
