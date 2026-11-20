import { describe, expect, it } from 'vitest'
import {
  deriveAskAnswer,
  deriveAskAnswers,
  emptyChoice,
  encodeAskAnswers,
  splitRecommended
} from '../src/shared/ask-questions'
import type { AskQuestionItem } from '../src/shared/ask-questions'

/** Порт AskQuestionTest.kt: splitRecommended, deriveAnswer, encodeAskAnswers (+ заметки). */

const QUESTION: AskQuestionItem = {
  header: 'Auth',
  question: 'Which auth?',
  multiSelect: false,
  options: [
    { label: 'Option A (Recommended)', description: 'first', preview: '**A** preview', recommendedReason: 'safer' },
    { label: 'Option B', description: 'second', preview: null, recommendedReason: null }
  ]
}

describe('splitRecommended', () => {
  it('strips the (Recommended) suffix case-insensitively', () => {
    expect(splitRecommended('Option A (Recommended)')).toEqual({ text: 'Option A', recommended: true })
    expect(splitRecommended('Option A (recommended) ')).toEqual({ text: 'Option A', recommended: true })
    expect(splitRecommended('Option B')).toEqual({ text: 'Option B', recommended: false })
  })
})

describe('deriveAskAnswer', () => {
  it('single select returns the option with its preview', () => {
    const answer = deriveAskAnswer(QUESTION, 0, { ...emptyChoice(), selected: 'Option A (Recommended)' })
    expect(answer).toEqual({
      kind: 'option',
      questionIndex: 0,
      question: 'Which auth?',
      label: 'Option A (Recommended)',
      preview: '**A** preview',
      notes: null
    })
  })

  it('custom answer wins over selection when active', () => {
    const answer = deriveAskAnswer(QUESTION, 0, {
      ...emptyChoice(),
      selected: 'Option B',
      customActive: true,
      customText: '  my own  '
    })
    expect(answer).toEqual({ kind: 'custom', questionIndex: 0, question: 'Which auth?', text: 'my own', notes: null })
  })

  it('multi keeps only known labels and own text', () => {
    const multi: AskQuestionItem = { ...QUESTION, multiSelect: true }
    const answer = deriveAskAnswer(multi, 1, {
      ...emptyChoice(),
      multi: ['Option B', 'ghost'],
      customActive: true,
      customText: 'own'
    })
    expect(answer).toEqual({
      kind: 'multi',
      questionIndex: 1,
      question: 'Which auth?',
      selected: ['Option B'],
      ownText: 'own',
      notes: null
    })
  })

  it('chat mark answers with the chat kind', () => {
    expect(deriveAskAnswer(QUESTION, 2, { ...emptyChoice(), chatMarked: true })).toEqual({
      kind: 'chat',
      questionIndex: 2,
      question: 'Which auth?'
    })
  })

  it('attaches a trimmed note to option, custom and multi answers', () => {
    const multi: AskQuestionItem = { ...QUESTION, multiSelect: true }
    expect(deriveAskAnswer(QUESTION, 0, { ...emptyChoice(), selected: 'Option B', note: '  keep the token  ' })).toMatchObject({
      kind: 'option',
      notes: 'keep the token'
    })
    expect(
      deriveAskAnswer(QUESTION, 0, { ...emptyChoice(), customActive: true, customText: 'own', note: 'note' })
    ).toMatchObject({ kind: 'custom', notes: 'note' })
    expect(
      deriveAskAnswer(multi, 0, { ...emptyChoice(), multi: ['Option B'], note: 'note' })
    ).toMatchObject({ kind: 'multi', notes: 'note' })
  })

  it('blank note becomes null, chat drops the note', () => {
    expect(deriveAskAnswer(QUESTION, 0, { ...emptyChoice(), selected: 'Option B', note: '   ' })).toMatchObject({
      kind: 'option',
      notes: null
    })
    expect(deriveAskAnswer(QUESTION, 0, { ...emptyChoice(), chatMarked: true, note: 'note' })).toEqual({
      kind: 'chat',
      questionIndex: 0,
      question: 'Which auth?'
    })
  })

  it('unanswered question yields null', () => {
    expect(deriveAskAnswer(QUESTION, 0, emptyChoice())).toBeNull()
  })

  it('deriveAskAnswers collects answers in question order', () => {
    const answers = deriveAskAnswers([QUESTION, QUESTION], [
      emptyChoice(),
      { ...emptyChoice(), selected: 'Option B' }
    ])
    expect(answers).toHaveLength(1)
    expect(answers[0]).toMatchObject({ questionIndex: 1, kind: 'option' })
  })
})

describe('encodeAskAnswers', () => {
  it('encodes option, custom, multi and chat answers', () => {
    const json = JSON.parse(
      encodeAskAnswers([
        { kind: 'option', questionIndex: 0, question: 'q0', label: 'A', preview: 'p', notes: null },
        { kind: 'custom', questionIndex: 1, question: 'q1', text: 'own', notes: null },
        { kind: 'multi', questionIndex: 2, question: 'q2', selected: ['A', 'B'], ownText: null, notes: null },
        { kind: 'chat', questionIndex: 3, question: 'q3' }
      ])
    )
    expect(json).toEqual({
      cancelled: false,
      answers: [
        { questionIndex: 0, question: 'q0', kind: 'option', answer: 'A', preview: 'p' },
        { questionIndex: 1, question: 'q1', kind: 'custom', answer: 'own' },
        { questionIndex: 2, question: 'q2', kind: 'multi', selected: ['A', 'B'] },
        { questionIndex: 3, question: 'q3', kind: 'chat' }
      ]
    })
  })

  it('omits preview and own answer when absent', () => {
    const json = JSON.parse(
      encodeAskAnswers([{ kind: 'multi', questionIndex: 0, question: 'q', selected: ['A'], ownText: 'x', notes: null }])
    )
    expect(json.answers[0]).toEqual({ questionIndex: 0, question: 'q', kind: 'multi', selected: ['A'], answer: 'x' })
  })

  it('emits notes only when present', () => {
    const json = JSON.parse(
      encodeAskAnswers([
        { kind: 'option', questionIndex: 0, question: 'q0', label: 'A', preview: null, notes: 'my note' },
        { kind: 'custom', questionIndex: 1, question: 'q1', text: 'own', notes: null }
      ])
    )
    expect(json.answers[0]).toEqual({ questionIndex: 0, question: 'q0', kind: 'option', answer: 'A', notes: 'my note' })
    expect(json.answers[1]).toEqual({ questionIndex: 1, question: 'q1', kind: 'custom', answer: 'own' })
  })
})
