import { useState } from 'react'
import { Markdown } from './Markdown'
import type { DialogAnswer } from '../../../shared/agent-events'
import {
  deriveAskAnswers,
  emptyChoice,
  encodeAskAnswers,
  splitRecommended
} from '../../../shared/ask-questions'
import { useT } from '../lib/i18n'
import type { AskChoice, AskQuestionItem, AskQuestionRequest } from '../../../shared/ask-questions'

/** Инлайн-карточка опроса `ask_question` (порт `ui/QuestionPanel.kt`):
 *  вопросы стопкой, у каждого — варианты, «Свой вариант», заметка, пометка «Нужно пояснение».
 *  После отправки — квитанция по каждому вопросу. */
export function AskQuestionCard({
  request,
  receipt,
  onAnswer
}: {
  request: AskQuestionRequest
  receipt: string | null
  onAnswer: (answer: DialogAnswer) => void
}): React.JSX.Element {
  const [choices, setChoices] = useState<AskChoice[]>(() => request.questions.map(() => emptyChoice()))
  const t = useT()

  if (receipt !== null) {
    if (receipt !== 'answered') {
      return <div className="dialog-card receipt">{t(receipt === 'cancelled' ? 'cancelled' : 'expired')}</div>
    }
    return (
      <div className="dialog-card receipt ask-receipt">
        {request.questions.map((question, index) => {
          const choice = choices[index] ?? emptyChoice()
          const value = receiptValue(question, choice)
          return (
            <div key={index} className={`ask-receipt-line ${value === null ? 'missed' : ''}`}>
              ✓ {question.header.trim().length > 0 ? question.header : question.question} →{' '}
              {value === null ? t('— no answer') : value.startsWith('→') ? t('→ clarify in chat') : value}
            </div>
          )
        })}
      </div>
    )
  }

  const update = (index: number, patch: Partial<AskChoice>): void => {
    setChoices(choices.map((c, i) => (i === index ? { ...c, ...patch } : c)))
  }

  const answers = deriveAskAnswers(request.questions, choices)
  const answeredCount = answers.filter((a) => a.kind !== 'chat').length
  const chatCount = answers.filter((a) => a.kind === 'chat').length
  const noteCount = answers.filter((a) => a.kind !== 'chat' && a.notes !== null).length

  const submit = (): void => {
    if (answers.length === 0) return
    onAnswer({ kind: 'value', value: encodeAskAnswers(answers) })
  }

  return (
    <div className="dialog-card ask-card">
      {request.questions.map((question, index) => (
        <QuestionView key={index} index={index} question={question} choice={choices[index] ?? emptyChoice()} update={update} />
      ))}
      <div className="ask-footer">
        <span className="ask-counter">
          {t('{count} answered', { count: answeredCount })}
          {chatCount > 0 ? t(' · {count} to chat', { count: chatCount }) : ''}
          {noteCount > 0 ? t(' · {count} with note', { count: noteCount }) : ''}
        </span>
        <span className="spacer" />
        <button className="ask-cancel" onClick={() => onAnswer({ kind: 'cancelled' })}>
          {t('Cancel')}
        </button>
        <button className="ask-submit" disabled={answers.length === 0} onClick={submit}>
          {t('Submit')}
          {answeredCount > 0 ? ` · ${answeredCount}` : ''}
        </button>
      </div>
    </div>
  )
}

function receiptValue(question: AskQuestionItem, choice: AskChoice): string | null {
  if (choice.chatMarked) return '→ clarify in chat'
  if (question.multiSelect) {
    const selected = choice.multi.filter((label) => question.options.some((o) => o.label === label))
    const own = choice.customActive ? choice.customText.trim() : ''
    if (selected.length === 0 && own.length === 0) return null
    return [...selected, ...(own.length > 0 ? [`"${own}"`] : [])].join(', ')
  }
  if (choice.customActive && choice.customText.trim().length > 0) return `"${choice.customText.trim()}"`
  if (choice.selected !== null) return splitRecommended(choice.selected).text
  return null
}

function QuestionView({
  index,
  question,
  choice,
  update
}: {
  index: number
  question: AskQuestionItem
  choice: AskChoice
  update: (index: number, patch: Partial<AskChoice>) => void
}): React.JSX.Element {
  const t = useT()
  const disabled = choice.chatMarked
  const selectOption = (label: string): void => {
    if (disabled) return
    if (question.multiSelect) {
      const multi = choice.multi.includes(label) ? choice.multi.filter((l) => l !== label) : [...choice.multi, label]
      update(index, { multi })
    } else {
      update(index, { selected: label, customActive: false })
    }
  }
  const selectCustom = (): void => {
    if (disabled) return
    if (question.multiSelect) {
      update(index, { customActive: !choice.customActive })
    } else {
      update(index, { customActive: true, selected: null })
    }
  }
  const preview =
    !question.multiSelect && choice.selected !== null
      ? (question.options.find((o) => o.label === choice.selected)?.preview ?? null)
      : null

  return (
    <div className="ask-question">
      {question.header.trim().length > 0 && <span className="ask-chip">{question.header.toUpperCase()}</span>}
      <div className="ask-question-text">{question.question}</div>
      <div className="ask-options">
        {question.options.map((option) => {
          const { text, recommended, reason } = readOption(option.label, option.recommendedReason)
          const on = question.multiSelect
            ? choice.multi.includes(option.label)
            : choice.selected === option.label && !choice.customActive
          return (
            <button
              key={option.label}
              type="button"
              className={`ask-option ${on ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
              onClick={() => selectOption(option.label)}
            >
              <span className="ask-mark">{question.multiSelect ? (on ? '☑' : '☐') : on ? '●' : '○'}</span>
              <span className="ask-option-body">
                <span className="ask-option-label">
                  {text}
                  {recommended && <span className="ask-recommended"> {t('Recommended')}</span>}
                </span>
                {option.description.trim().length > 0 && <span className="ask-option-desc">{option.description}</span>}
                {reason !== null && <span className="ask-option-why">{t('Why: {reason}', { reason })}</span>}
              </span>
            </button>
          )
        })}
        <button
          type="button"
          className={`ask-option ${choice.customActive ? 'selected' : ''} ${disabled ? 'disabled' : ''}`}
          onClick={selectCustom}
        >
          <span className="ask-mark">{choice.customActive ? (question.multiSelect ? '☑' : '●') : question.multiSelect ? '☐' : '○'}</span>
          <span className="ask-option-body">
            <span className="ask-option-label">{t('Own answer')}</span>
          </span>
        </button>
        {choice.customActive && (
          <textarea
            autoFocus
            rows={2}
            placeholder={t('Type your own answer…')}
            value={choice.customText}
            onChange={(e) => update(index, { customText: e.target.value })}
          />
        )}
      </div>
      {preview !== null && (
        <div className="ask-preview">
          <Markdown text={preview} />
        </div>
      )}
      {choice.noteOpen && (
        <input
          autoFocus
          type="text"
          className="ask-note-input"
          placeholder={t('Note to answer…')}
          value={choice.note}
          onChange={(e) => update(index, { note: e.target.value })}
        />
      )}
      <div className="ask-actions">
        <button type="button" className="ask-chat-toggle" onClick={() => update(index, { noteOpen: !choice.noteOpen })}>
          ✎ {t('Add note')}
        </button>
        <button
          type="button"
          className={`ask-chat-toggle ${choice.chatMarked ? 'marked' : ''}`}
          onClick={() => update(index, { chatMarked: !choice.chatMarked })}
        >
          {choice.chatMarked ? `◆ ${t('Clarify in chat')}` : `◇ ${t('Needs clarification')}`}
        </button>
      </div>
    </div>
  )
}

function readOption(label: string, reason: string | null): { text: string; recommended: boolean; reason: string | null } {
  const split = splitRecommended(label)
  return { text: split.text, recommended: split.recommended, reason: reason ?? null }
}
