import { beforeEach, describe, expect, it } from 'vitest'
import { openToolDiff, useToolDiffStore } from '../src/renderer/src/stores/tool-diff'
import { tabId } from '../src/renderer/src/stores/tabs'
import type { ProjectEntry } from '../src/shared/ipc-contracts'

/** Дифф вызова инструмента: контент в сторе под tabId вкладки tool-diff, повторное
 *  открытие той же вкладки заменяет контент. openTab персистит через window.piwright —
 *  в тестах его нет, persist глотает ошибку. */
const project: ProjectEntry = { kind: 'native', dir: 'D:\\tmp\\proj' }

describe('tool-diff store', () => {
  beforeEach(() => {
    useToolDiffStore.setState({ contents: {} })
  })

  it('openToolDiff пишет контент под tabId вкладки tool-diff', () => {
    openToolDiff(project, 'src/a.ts', 'old', 'new')
    const id = tabId({ kind: 'tool-diff', path: 'src/a.ts' })
    expect(useToolDiffStore.getState().contents[id]).toEqual({ original: 'old', modified: 'new' })
  })

  it('повторный вызов заменяет контент той же вкладки', () => {
    openToolDiff(project, 'src/a.ts', 'old1', 'new1')
    openToolDiff(project, 'src/a.ts', 'old2', 'new2')
    const id = tabId({ kind: 'tool-diff', path: 'src/a.ts' })
    expect(useToolDiffStore.getState().contents[id]).toEqual({ original: 'old2', modified: 'new2' })
  })

  it('разные пути — разные записи', () => {
    openToolDiff(project, 'src/a.ts', 'a-old', 'a-new')
    openToolDiff(project, 'src/b.ts', 'b-old', 'b-new')
    const contents = useToolDiffStore.getState().contents
    expect(Object.keys(contents)).toHaveLength(2)
    expect(contents[tabId({ kind: 'tool-diff', path: 'src/b.ts' })]).toEqual({ original: 'b-old', modified: 'b-new' })
  })
})
