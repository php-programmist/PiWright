import { describe, expect, it } from 'vitest'
import { cleanCommitMessage, buildCommitPrompt, truncateDiff } from '../src/main/git/commit-message'

describe('cleanCommitMessage', () => {
  it('keeps a plain message', () => {
    expect(cleanCommitMessage('  fix: something broken  ')).toBe('fix: something broken')
  })

  it('strips markdown fences', () => {
    expect(cleanCommitMessage('```\nfix: fenced\n```')).toBe('fix: fenced')
    expect(cleanCommitMessage('```text\nfix: fenced with lang\n\nbody\n```')).toBe('fix: fenced with lang\n\nbody')
  })
})

describe('truncateDiff', () => {
  it('keeps short diffs', () => {
    expect(truncateDiff('short')).toBe('short')
  })

  it('truncates long diffs with a note', () => {
    const truncated = truncateDiff('x'.repeat(80_001))
    expect(truncated.length).toBeLessThan(80_100)
    expect(truncated.endsWith('[diff truncated]')).toBe(true)
  })
})

describe('buildCommitPrompt', () => {
  it('embeds the diff and the rules', () => {
    const prompt = buildCommitPrompt('diff --git a/x b/x')
    expect(prompt).toContain('diff --git a/x b/x')
    expect(prompt).toContain('commit message')
  })
})
