/** Опрос `ask_question` (порт `core/AskQuestion.kt`). Расширение шлёт пачку вопросов
 *  одним `input`-запросом: заголовок = префикс + base64(JSON), ответ = JSON-строка в `value`. */

/** Префикс заголовка `input`-запроса; вшит и в расширение (resources/ask-question/src/rpc.ts). */
export const ASK_PAYLOAD_PREFIX = 'pi-wrapper:ask:'

export interface AskOption {
  label: string
  description: string
  preview: string | null
  recommendedReason: string | null
}

export interface AskQuestionItem {
  header: string
  question: string
  options: AskOption[]
  multiSelect: boolean
}

export interface AskQuestionRequest {
  questions: AskQuestionItem[]
}

/** Ответ на один вопрос; chat — «нужно пояснение»: вопрос не отвечен, агент распишет его в чате.
 *  notes — заметка пользователя, липнет к option/custom/multi (расширение пишет её в tool result). */
export type AskAnswer =
  | { kind: 'option'; questionIndex: number; question: string; label: string; preview: string | null; notes: string | null }
  | { kind: 'custom'; questionIndex: number; question: string; text: string; notes: string | null }
  | { kind: 'multi'; questionIndex: number; question: string; selected: string[]; ownText: string | null; notes: string | null }
  | { kind: 'chat'; questionIndex: number; question: string }

/** Выбор пользователя по одному вопросу (состояние карточки). */
export interface AskChoice {
  selected: string | null
  customActive: boolean
  customText: string
  multi: string[]
  chatMarked: boolean
  noteOpen: boolean
  note: string
}

/** Диалог-опрос — вариант ExtensionDialog (union в agent-events). */
export interface AskDialog {
  kind: 'ask'
  request: AskQuestionRequest
  timeoutMs: number | null
}

/** «(Recommended)» в конце метки — рекомендация; текст без суффикса. Порт `splitRecommended`. */
export function splitRecommended(label: string): { text: string; recommended: boolean } {
  const match = /\s*\(recommended\)\s*$/i.exec(label)
  return match
    ? { text: label.slice(0, match.index).trim(), recommended: true }
    : { text: label, recommended: false }
}

/** Ответ одного вопроса из состояния карточки; null — вопрос не отвечен. Порт `deriveAnswer`. */
export function deriveAskAnswer(question: AskQuestionItem, index: number, choice: AskChoice): AskAnswer | null {
  if (choice.chatMarked) return { kind: 'chat', questionIndex: index, question: question.question }
  const note = choice.note.trim()
  const notes = note.length > 0 ? note : null
  if (question.multiSelect) {
    const selected = choice.multi.filter((label) => question.options.some((o) => o.label === label))
    const own = choice.customActive ? choice.customText.trim() : ''
    if (selected.length === 0 && own.length === 0) return null
    return { kind: 'multi', questionIndex: index, question: question.question, selected, ownText: own.length > 0 ? own : null, notes }
  }
  if (choice.customActive && choice.customText.trim().length > 0) {
    return { kind: 'custom', questionIndex: index, question: question.question, text: choice.customText.trim(), notes }
  }
  if (choice.selected !== null) {
    const option = question.options.find((o) => o.label === choice.selected)
    if (option === undefined) return null
    return { kind: 'option', questionIndex: index, question: question.question, label: option.label, preview: option.preview, notes }
  }
  return null
}

/** Ответы всех отвеченных вопросов в порядке вопросов. */
export function deriveAskAnswers(
  questions: readonly AskQuestionItem[],
  choices: readonly AskChoice[]
): AskAnswer[] {
  return questions
    .map((question, index) => deriveAskAnswer(question, index, choices[index] ?? emptyChoice()))
    .filter((answer): answer is AskAnswer => answer !== null)
}

export function emptyChoice(): AskChoice {
  return { selected: null, customActive: false, customText: '', multi: [], chatMarked: false, noteOpen: false, note: '' }
}

/** JSON-ответ расширению: `{answers: [...], cancelled: false}`. Порт `encodeAskAnswers`. */
export function encodeAskAnswers(answers: readonly AskAnswer[]): string {
  const list = answers.map((answer): Record<string, unknown> => {
    const entry: Record<string, unknown> = { questionIndex: answer.questionIndex, question: answer.question }
    switch (answer.kind) {
      case 'option':
        entry['kind'] = 'option'
        entry['answer'] = answer.label
        if (answer.preview !== null) entry['preview'] = answer.preview
        if (answer.notes !== null) entry['notes'] = answer.notes
        break
      case 'custom':
        entry['kind'] = 'custom'
        entry['answer'] = answer.text
        if (answer.notes !== null) entry['notes'] = answer.notes
        break
      case 'multi':
        entry['kind'] = 'multi'
        entry['selected'] = answer.selected
        if (answer.ownText !== null) entry['answer'] = answer.ownText
        if (answer.notes !== null) entry['notes'] = answer.notes
        break
      case 'chat':
        entry['kind'] = 'chat'
        break
    }
    return entry
  })
  return JSON.stringify({ answers: list, cancelled: false })
}
