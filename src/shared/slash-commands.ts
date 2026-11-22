import type { PiSlashCommand } from './protocol-types'

/** Токен slash-команды в начале промпта: `/...` без пробелов; null — автодополнение не показываем. */
export function slashTokenOf(input: string): string | null {
  if (!input.startsWith('/') || input.length < 1) return null
  if (/\s/.test(input)) return null
  return input.slice(1)
}

/** Команды с именем, начинающимся на токен (без учёта регистра), по алфавиту. */
export function filterSlashCommands(commands: PiSlashCommand[], token: string): PiSlashCommand[] {
  const query = token.toLowerCase()
  return commands
    .filter((c) => c.name.toLowerCase().startsWith(query))
    .sort((a, b) => a.name.localeCompare(b.name))
}
