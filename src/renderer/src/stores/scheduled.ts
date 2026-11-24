/** Отложенные промпты (очередь сессий): список живёт в main, здесь — зеркало для UI.
 *  Обновления приходят событием scheduled:changed (срабатывание/отмена в любом месте). */
import { create } from 'zustand'
import type { SchedulePromptInput, ScheduledPrompt } from '../../../shared/ipc-contracts'

interface ScheduledState {
  items: ScheduledPrompt[]
  refresh: () => Promise<void>
  /** true — запланировано. */
  schedule: (input: SchedulePromptInput) => Promise<boolean>
  cancel: (id: string) => Promise<void>
}

export const useScheduledStore = create<ScheduledState>((set) => ({
  items: [],
  refresh: async () => {
    const result = await window.piwright.scheduledList()
    set({ items: result.ok ? result.items : [] })
  },
  schedule: async (input) => {
    const result = await window.piwright.schedulePrompt(input)
    if (result.ok) await useScheduledStore.getState().refresh()
    return result.ok
  },
  cancel: async (id) => {
    await window.piwright.scheduledCancel(id)
    await useScheduledStore.getState().refresh()
  }
}))
