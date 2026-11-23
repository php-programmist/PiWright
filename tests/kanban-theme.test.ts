/** Темы канбана: валидация импортного JSON, слияние, файл kanban-themes.json, диалоги импорта/экспорта. */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  KANBAN_BUILTIN_THEMES,
  KANBAN_DEFAULT_THEME_ID,
  kanbanThemeAccent,
  parseKanbanTheme,
  parseKanbanThemeDoc,
  resolveKanbanTheme
} from '../src/shared/kanban-theme'
import type { KanbanTheme } from '../src/shared/kanban-theme'
import {
  KanbanThemeService,
  mergeKanbanThemes,
  readKanbanThemes,
  writeKanbanThemes
} from '../src/main/kanban/kanban-theme-service'

const dialogs = vi.hoisted(() => ({
  openPath: '' as string,
  canceledOpen: false,
  savePath: '' as string,
  canceledSave: false
}))

vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: async () =>
      dialogs.canceledOpen ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [dialogs.openPath] },
    showSaveDialog: async () =>
      dialogs.canceledSave ? { canceled: true } : { canceled: false, filePath: dialogs.savePath }
  }
}))

function theme(overrides: Partial<KanbanTheme> = {}): KanbanTheme {
  return {
    id: 'neon',
    name: 'Neon',
    accents: ['#ff00aa', '#00ffcc'],
    columnTint: 'rgba(255, 0, 170, 0.12)',
    columnBorder: 'rgba(255, 0, 170, 0.32)',
    cardTint: 'rgba(255, 0, 170, 0.08)',
    cardBorder: 'rgba(255, 0, 170, 0.26)',
    badge: '#ff66cc',
    ...overrides
  }
}

function rawTheme(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...theme(), ...overrides }
}

describe('parseKanbanTheme', () => {
  it('принимает корректную тему и нормализует id/name', () => {
    const parsed = parseKanbanTheme(rawTheme({ id: ' Neon ' }))
    expect(parsed).not.toBeNull()
    expect(parsed?.id).toBe('neon')
    expect(parsed?.name).toBe('Neon')
  })

  it('имя по умолчанию, когда пустое', () => {
    expect(parseKanbanTheme(rawTheme({ name: '   ' }))?.name).toBe('neon')
  })

  it('отклоняет id дефолтной темы', () => {
    expect(parseKanbanTheme(rawTheme({ id: KANBAN_DEFAULT_THEME_ID }))).toBeNull()
  })

  it('отклоняет битый id, пустые и лишние акценты, небезопасный цвет', () => {
    expect(parseKanbanTheme(rawTheme({ id: 'A' }))).toBeNull()
    expect(parseKanbanTheme(rawTheme({ accents: [] }))).toBeNull()
    expect(parseKanbanTheme(rawTheme({ accents: new Array(20).fill('#fff') }))).toBeNull()
    expect(parseKanbanTheme(rawTheme({ cardTint: 'red; } body { display: none' }))).toBeNull()
    expect(parseKanbanTheme(rawTheme({ badge: 'url(evil)' }))).toBeNull()
  })

  it('принимает hex, rgb(), hsl() и именованные цвета', () => {
    for (const color of ['#abc', '#aabbcc', 'rgb(1, 2, 3)', 'rgba(1, 2, 3, 0.5)', 'hsl(120, 50%, 50%)', 'tomato']) {
      expect(parseKanbanTheme(rawTheme({ cardTint: color }))).not.toBeNull()
    }
  })
})

describe('parseKanbanThemeDoc', () => {
  it('разбирает тему, массив и { version, themes }', () => {
    expect(parseKanbanThemeDoc(rawTheme({ id: 'aa' }))).toHaveLength(1)
    expect(parseKanbanThemeDoc([rawTheme({ id: 'aa' }), rawTheme({ id: 'bb' })])).toHaveLength(2)
    expect(parseKanbanThemeDoc({ version: 1, themes: [rawTheme({ id: 'aa' })] })).toHaveLength(1)
  })

  it('режет дубликаты id и мусор', () => {
    expect(parseKanbanThemeDoc([rawTheme({ id: 'aa' }), rawTheme({ id: 'aa' }), 'x', null])).toHaveLength(1)
    expect(parseKanbanThemeDoc('nope')).toEqual([])
    expect(parseKanbanThemeDoc(null)).toEqual([])
  })
})

describe('resolveKanbanTheme / kanbanThemeAccent', () => {
  it('своя тема важнее дефолтной, битый id — дефолт', () => {
    const custom = theme({ id: 'slate' })
    expect(resolveKanbanTheme([custom], 'slate').cardTint).toBe(custom.cardTint)
    expect(resolveKanbanTheme([], 'slate').id).toBe('slate')
    expect(resolveKanbanTheme([], 'removed').id).toBe(KANBAN_BUILTIN_THEMES[0].id)
  })

  it('акценты цикличны', () => {
    const t = theme({ accents: ['#111111', '#222222'] })
    expect(kanbanThemeAccent(t, 0)).toBe('#111111')
    expect(kanbanThemeAccent(t, 2)).toBe('#111111')
  })
})

describe('mergeKanbanThemes', () => {
  it('заменяет по id, добавляет новые, дефолтные id игнорирует', () => {
    const merged = mergeKanbanThemes([theme({ id: 'aa' })], [theme({ id: 'aa', name: 'A2' }), theme({ id: 'bb' }), theme({ id: 'ocean' })])
    expect(merged.map((item) => item.id)).toEqual(['aa', 'bb'])
    expect(merged[0].name).toBe('A2')
  })
})

describe('KanbanThemeService', () => {
  let dir = ''
  let file = ''

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'piwright-kbtheme-'))
    file = join(dir, 'kanban-themes.json')
    dialogs.openPath = ''
    dialogs.canceledOpen = false
    dialogs.savePath = ''
    dialogs.canceledSave = false
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('чтение отсутствующего и битого файла — пустой список', async () => {
    expect(readKanbanThemes(file)).toEqual([])
    await writeFile(file, '{oops', 'utf8')
    expect(readKanbanThemes(file)).toEqual([])
  })

  it('запись и чтение кругом, бэкап .bak', async () => {
    writeKanbanThemes(file, [theme()])
    writeKanbanThemes(file, [theme({ id: 'bb' })])
    expect(readKanbanThemes(file).map((t) => t.id)).toEqual(['bb'])
    expect(JSON.parse(await readFile(`${file}.bak`, 'utf8')).themes[0].id).toBe('neon')
  })

  it('remove удаляет свою тему и отказывает на чужой id', () => {
    writeKanbanThemes(file, [theme()])
    const service = new KanbanThemeService(file)
    expect(service.remove('neon').ok).toBe(true)
    expect(service.list().themes).toEqual([])
    expect(service.remove('neon').ok).toBe(false)
  })

  it('импорт диалогом сливает темы в файл', async () => {
    const source = join(dir, 'in.json')
    await writeFile(source, JSON.stringify({ version: 1, themes: [rawTheme({ id: 'aa' }), rawTheme({ id: 'bb' })] }), 'utf8')
    dialogs.openPath = source
    const first = await new KanbanThemeService(file).importWithDialog()
    expect(first.ok && first.imported).toBe(2)
    const again = await new KanbanThemeService(file).importWithDialog()
    expect(again.imported).toBe(0)
    expect(again.skipped).toBe(2)
    expect(readKanbanThemes(file).map((t) => t.id)).toEqual(['aa', 'bb'])
  })

  it('импорт отменяется и сообщает ошибку без валидных тем', async () => {
    dialogs.canceledOpen = true
    expect((await new KanbanThemeService(file).importWithDialog()).error).toBe('cancelled')
    dialogs.canceledOpen = false
    const source = join(dir, 'bad.json')
    await writeFile(source, '{"themes":[]}', 'utf8')
    dialogs.openPath = source
    expect((await new KanbanThemeService(file).importWithDialog()).ok).toBe(false)
  })

  it('экспорт пишет JSON и дописывает .json к пути без расширения', async () => {
    writeKanbanThemes(file, [theme(), theme({ id: 'bb' })])
    const target = join(dir, 'out')
    dialogs.savePath = target
    const result = await new KanbanThemeService(file).exportWithDialog('neon')
    expect(result.ok && result.path).toBe(`${target}.json`)
    expect(JSON.parse(await readFile(`${target}.json`, 'utf8')).themes).toHaveLength(1)
  })

  it('экспорт `*` пишет все свои темы, неизвестный id — ошибка', async () => {
    writeKanbanThemes(file, [theme(), theme({ id: 'bb' })])
    dialogs.savePath = join(dir, 'all.json')
    const all = await new KanbanThemeService(file).exportWithDialog('*')
    expect(all.ok).toBe(true)
    expect(JSON.parse(await readFile(all.path, 'utf8')).themes).toHaveLength(2)
    dialogs.savePath = join(dir, 'none.json')
    expect((await new KanbanThemeService(file).exportWithDialog('nope')).ok).toBe(false)
  })

  it('экспорт дефолтной темы из кода, когда файл пуст', async () => {
    dialogs.savePath = join(dir, 'ocean.json')
    const result = await new KanbanThemeService(file).exportWithDialog('ocean')
    expect(result.ok).toBe(true)
    const doc = JSON.parse(await readFile(result.path, 'utf8'))
    expect(doc.themes).toHaveLength(1)
    expect(doc.themes[0].id).toBe('ocean')
    expect(doc.themes[0].accents).toEqual(KANBAN_BUILTIN_THEMES[1].accents)
  })

  it('импорт смеси дефолтных и своих тем: дефолтные пропускаются', async () => {
    const source = join(dir, 'mix.json')
    await writeFile(source, JSON.stringify([rawTheme({ id: 'ocean' }), rawTheme({ id: 'aa' })]), 'utf8')
    dialogs.openPath = source
    const result = await new KanbanThemeService(file).importWithDialog()
    expect(result.ok && result.imported).toBe(1)
    expect(readKanbanThemes(file).map((t) => t.id)).toEqual(['aa'])
    expect(new KanbanThemeService(file).remove('ocean').ok).toBe(false)
  })
})

describe('настройки', () => {
  it('kanbanTheme в дефолтных настройках', async () => {
    const { DEFAULT_SETTINGS } = await import('../src/main/settings/settings')
    expect(DEFAULT_SETTINGS.kanbanTheme).toBe(KANBAN_DEFAULT_THEME_ID)
  })
})
