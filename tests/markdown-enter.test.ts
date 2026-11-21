import { describe, expect, it } from 'vitest'
import { continueListItem } from '../src/shared/markdown-enter'

const at = (text: string, caret = text.length) => continueListItem(text, caret, caret)

describe('continueListItem', () => {
  it('continues a bullet list', () => {
    expect(at('- a')).toEqual({ text: '- a\n- ', caret: 6 })
  })

  it('keeps the bullet char and indentation', () => {
    expect(at('* a')?.text).toBe('* a\n* ')
    expect(at('+ a')?.text).toBe('+ a\n+ ')
    expect(at('  - a')?.text).toBe('  - a\n  - ')
  })

  it('keeps the marker gap width', () => {
    expect(at('-  a')?.text).toBe('-  a\n-  ')
  })

  it('continues an ordered list and bumps the number', () => {
    expect(at('1. a')?.text).toBe('1. a\n2. ')
    expect(at('1) a')?.text).toBe('1) a\n2) ')
    expect(at('9. a')?.text).toBe('9. a\n10. ')
    expect(at('10. a')?.text).toBe('10. a\n11. ')
  })

  it('inserts the new item between the split line', () => {
    expect(at('1. a\n2. b', 4)?.text).toBe('1. a\n2. \n2. b')
  })

  it('continues a task list and clears the checkbox', () => {
    expect(at('- [ ] task')?.text).toBe('- [ ] task\n- [ ] ')
    expect(at('- [x] done')?.text).toBe('- [x] done\n- [ ] ')
    expect(at('- [X] done')?.caret).toBe(17)
  })

  it('moves the text after the caret onto the new item', () => {
    expect(at('- abc', 4)).toEqual({ text: '- ab\n- c', caret: 7 })
  })

  it('ends the list on an empty item', () => {
    expect(at('- a\n- \n', 5)).toEqual({ text: '- a\n', caret: 4 })
    expect(at('- ')).toEqual({ text: '', caret: 0 })
    expect(at('-')).toEqual({ text: '', caret: 0 })
    expect(at('- [ ]')).toEqual({ text: '', caret: 0 })
    expect(at('  1. ')).toEqual({ text: '', caret: 0 })
  })

  it('leaves non-list lines alone', () => {
    expect(at('hello')).toBeNull()
    expect(at('   continued')).toBeNull()
    expect(at('# Heading')).toBeNull()
    expect(at('---')).toBeNull()
    expect(at('1.foo')).toBeNull()
  })

  it('leaves the caret inside the marker alone', () => {
    expect(at('- abc', 1)).toBeNull()
    expect(at('1. abc', 2)).toBeNull()
  })

  it('leaves lines inside a fenced block alone', () => {
    expect(at('```\n- a\n```', 5)).toBeNull()
    expect(at('~~~\n- a\n~~~', 5)).toBeNull()
    expect(at('```\nx\n```\n- a')?.text).toBe('```\nx\n```\n- a\n- ')
  })

  it('keeps CRLF endings on the moved tail', () => {
    expect(at('- a\r\n- b', 3)?.text).toBe('- a\n- \r\n- b')
  })

  it('leaves a selection to the default behaviour', () => {
    expect(continueListItem('- a', 2, 3)).toBeNull()
  })

  it('rejects out-of-range carets', () => {
    expect(continueListItem('- a', -1, -1)).toBeNull()
    expect(continueListItem('- a', 99, 99)).toBeNull()
  })
})
