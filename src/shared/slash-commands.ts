import type { PiSlashCommand } from './protocol-types'

/** Токен slash-команды в начале промпта: `/...` без пробелов; null — автодополнение не показываем. */
export function slashTokenOf(input: string): string | null {
  if (!input.startsWith('/') || input.length < 1) return null
  if (/\s/.test(input)) return null
  return input.slice(1)
}

/** Команды с именем, начинающимся на токен или содержащим его (без учёта регистра); префиксные — первыми, внутри групп по алфавиту. */
export function filterSlashCommands(commands: PiSlashCommand[], token: string): PiSlashCommand[] {
  const query = token.toLowerCase()
  const byName = (a: PiSlashCommand, b: PiSlashCommand): number => a.name.localeCompare(b.name)
  const prefix = commands.filter((c) => c.name.toLowerCase().startsWith(query)).sort(byName)
  if (query === '') return prefix
  const substring = commands
    .filter((c) => {
      const name = c.name.toLowerCase()
      return !name.startsWith(query) && name.includes(query)
    })
    .sort(byName)
  return [...prefix, ...substring]
}
