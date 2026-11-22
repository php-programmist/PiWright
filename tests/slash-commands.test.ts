import { describe, expect, it } from 'vitest'
import { slashTokenOf, filterSlashCommands } from '../src/shared/slash-commands'
import type { PiSlashCommand } from '../src/shared/protocol-types'

const cmd = (name: string, source: string | null = null): PiSlashCommand => ({
  name,
  description: `desc ${name}`,
  source
})

const COMMANDS: PiSlashCommand[] = [
  cmd('compact', 'core'),
  cmd('skill:autopilot', 'skill'),
  cmd('auto-review', 'extension'),
  cmd('Auto-Install', 'extension')
]

describe('slashTokenOf', () => {
  it('null для пустого и обычного текста', () => {
    expect(slashTokenOf('')).toBeNull()
    expect(slashTokenOf('hello')).toBeNull()
    expect(slashTokenOf('hello /world')).toBeNull()
  })

  it('токен без слэша', () => {
    expect(slashTokenOf('/')).toBe('')
    expect(slashTokenOf('/auto')).toBe('auto')
    expect(slashTokenOf('/skill:work')).toBe('skill:work')
  })

  it('пробел закрывает токен', () => {
    expect(slashTokenOf('/auto now')).toBeNull()
    expect(slashTokenOf('/auto\t')).toBeNull()
    expect(slashTokenOf('/auto\n')).toBeNull()
  })
})

describe('filterSlashCommands', () => {
  it('фильтрует по префиксу без учёта регистра', () => {
    const names = filterSlashCommands(COMMANDS, 'auto').map((c) => c.name)
    expect(names).toEqual(['Auto-Install', 'auto-review'])
  })

  it('пустой токен — все команды по алфавиту', () => {
    const names = filterSlashCommands(COMMANDS, '').map((c) => c.name)
    expect(names).toEqual(['Auto-Install', 'auto-review', 'compact', 'skill:autopilot'])
  })

  it('нет совпадений — пустой список', () => {
    expect(filterSlashCommands(COMMANDS, 'zzz')).toEqual([])
  })
})
