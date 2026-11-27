/** Контент вкладок «дифф вызова инструмента» (edit/write): оригинал и изменённый текст
 *  конкретного вызова. В памяти процесса — вкладки tool-diff не персистятся (тексты
 *  больших правок в settings не пишутся), после рестарта вкладка не восстанавливается. */
import { create } from 'zustand'
import { tabId, useTabsStore } from './tabs'
import type { ProjectEntry } from '../../../shared/ipc-contracts'

export interface ToolDiffContent {
  original: string
  modified: string
}

interface ToolDiffState {
  contents: Record<string, ToolDiffContent>
  /** Записать/заменить контент вкладки (повторный клик по кнопке обновляет дифф). */
  set: (id: string, content: ToolDiffContent) => void
}

export const useToolDiffStore = create<ToolDiffState>((set) => ({
  contents: {},
  set: (id, content) => set((state) => ({ contents: { ...state.contents, [id]: content } }))
}))

/** Открыть вкладку с диффом вызова инструмента: контент в стор, вкладка kind 'tool-diff'. */
export function openToolDiff(project: ProjectEntry, path: string, original: string, modified: string): void {
  const id = tabId({ kind: 'tool-diff', path })
  useToolDiffStore.getState().set(id, { original, modified })
  useTabsStore.getState().openTab(project, { kind: 'tool-diff', path })
}
