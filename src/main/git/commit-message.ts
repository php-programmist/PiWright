/** Подготовка промпта и ответа для генерации сообщения коммита одноразовым pi. */

const MAX_DIFF_CHARS = 80_000

export function truncateDiff(diff: string): string {
  if (diff.length <= MAX_DIFF_CHARS) return diff
  return `${diff.slice(0, MAX_DIFF_CHARS)}\n… [diff truncated]`
}

export function buildCommitPrompt(diff: string): string {
  return [
    'Write a git commit message for the staged changes below.',
    '',
    'Rules:',
    '- Reply with the commit message text only: no explanations, no markdown fences, no quotes around the whole message.',
    '- First line: imperative summary, max 72 characters, no trailing period.',
    '- After a blank line add a short body only if the change is non-trivial.',
    '',
    'Staged diff:',
    '',
    truncateDiff(diff)
  ].join('\n')
}

/** Ответ модели: срезать markdown-заборы, если модель их поставила. */
export function cleanCommitMessage(raw: string): string {
  const text = raw.trim()
  const fenced = text.match(/^```[^\n]*\n([\s\S]*?)\n?```$/)
  return (fenced !== null ? fenced[1] : text).trim()
}
