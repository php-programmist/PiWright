import { create } from 'zustand'
import type { KanbanThemeImportResult } from '../../../shared/ipc-contracts'
import type { KanbanTheme } from '../../../shared/kanban-theme'

/** Пользовательские темы канбана (дефолтные — в коде, shared/kanban-theme.ts). */
interface KanbanThemeState {
  custom: KanbanTheme[]
  loaded: boolean
  loading: boolean
  error: string | null
  load: () => Promise<void>
  importThemes: () => Promise<KanbanThemeImportResult | null>
  exportTheme: (id: string) => Promise<string | null>
  remove: (id: string) => Promise<void>
}

export const useKanbanThemeStore = create<KanbanThemeState>((set, get) => ({
  custom: [],
  loaded: false,
  loading: false,
  error: null,

  load: async () => {
    if (get().loading) return
    set({ loading: true })
    const result = await window.piwright.kanbanThemeList()
    set({ loading: false, loaded: true, custom: result.ok ? result.themes : get().custom, error: result.error })
  },

  importThemes: async () => {
    const result = await window.piwright.kanbanThemeImport()
    if (result.ok) set({ custom: result.themes, error: null })
    else set({ error: result.error })
    return result
  },

  exportTheme: async (id) => {
    const result = await window.piwright.kanbanThemeExport(id)
    set({ error: result.error })
    return result.ok ? result.path : null
  },

  remove: async (id) => {
    const result = await window.piwright.kanbanThemeDelete(id)
    if (result.ok) set({ custom: result.themes, error: null })
    else set({ error: result.error })
  }
}))
