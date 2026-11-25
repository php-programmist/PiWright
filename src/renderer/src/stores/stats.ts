/** Статистика токенов: окно/фильтры/метрики + результат запроса. Открытие — из меню File. */
import { create } from 'zustand'
import type { StatsResult, StatsWindowKind } from '../../../shared/ipc-contracts'

export interface StatsMetrics {
  input: boolean
  output: boolean
  cacheRead: boolean
}

interface StatsState {
  open: boolean
  loading: boolean
  result: StatsResult | null
  kind: StatsWindowKind
  month: number
  year: number
  project: string | null
  model: string | null
  metrics: StatsMetrics
  stacked: boolean
  openModal: () => void
  closeModal: () => void
  setKind: (kind: StatsWindowKind) => void
  setCustom: (month: number, year: number) => void
  setProject: (project: string | null) => void
  setModel: (model: string | null) => void
  toggleMetric: (metric: keyof StatsMetrics) => void
  setStacked: (stacked: boolean) => void
  refresh: () => Promise<void>
}

export const useStatsStore = create<StatsState>((set, get) => ({
  open: false,
  loading: false,
  result: null,
  kind: 'day',
  month: new Date().getMonth() + 1,
  year: new Date().getFullYear(),
  project: null,
  model: null,
  metrics: { input: true, output: true, cacheRead: true },
  stacked: false,

  openModal: () => {
    set({ open: true })
    void get().refresh()
  },
  closeModal: () => set({ open: false }),
  setKind: (kind) => {
    set({ kind })
    void get().refresh()
  },
  setCustom: (month, year) => {
    set({ kind: 'custom', month, year })
    void get().refresh()
  },
  setProject: (project) => {
    set({ project })
    void get().refresh()
  },
  setModel: (model) => {
    set({ model })
    void get().refresh()
  },
  toggleMetric: (metric) => {
    const metrics = { ...get().metrics, [metric]: !get().metrics[metric] }
    set({ metrics })
  },
  setStacked: (stacked) => set({ stacked }),
  refresh: async () => {
    const { kind, month, year, project, model } = get()
    set({ loading: true })
    try {
      const result = await window.piwright.statsQuery({ kind, month, year, project, model })
      if (get().open) set({ result })
    } finally {
      if (get().open) set({ loading: false })
    }
  }
}))
