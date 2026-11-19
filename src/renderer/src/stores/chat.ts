import { create } from 'zustand'
import type { PiEventMessage, PiStatus, Settings } from '../../../shared/ipc-contracts'

interface ChatState {
  status: PiStatus
  settings: Settings | null
  userMessages: string[]
  assistantText: string
  thinkingText: string
  streaming: boolean
  applyEvent: (event: PiEventMessage) => void
  setStatus: (status: PiStatus) => void
  setSettings: (settings: Settings) => void
  addUserMessage: (text: string) => void
  resetTranscript: () => void
}

interface AssistantMessageEvent {
  type?: unknown
  delta?: unknown
}

/** Фаза 1: из потока событий берём только дельты текста/thinking и границы хода. */
export function reduceEvent(state: ChatState, event: PiEventMessage): Partial<ChatState> {
  if (event.type === 'agent_start') return { streaming: true }
  if (event.type === 'agent_settled' || event.type === 'agent_end') return { streaming: false }
  if (event.type !== 'message_update') return {}
  const raw = event.payload['assistantMessageEvent']
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const delta = raw as AssistantMessageEvent
  if (typeof delta['delta'] !== 'string') return {}
  if (delta['type'] === 'text_delta') return { assistantText: state.assistantText + delta['delta'] }
  if (delta['type'] === 'thinking_delta') return { thinkingText: state.thinkingText + delta['delta'] }
  return {}
}

export const useChatStore = create<ChatState>((set) => ({
  status: { state: 'idle', backend: null, model: null, sessionId: null, sessionFile: null, error: null },
  settings: null,
  userMessages: [],
  assistantText: '',
  thinkingText: '',
  streaming: false,
  applyEvent: (event) =>
    set((state) => {
      const patch = reduceEvent(state, event)
      return patch as Partial<ChatState>
    }),
  setStatus: (status) => set({ status }),
  setSettings: (settings) => set({ settings }),
  addUserMessage: (text) => set((state) => ({ userMessages: [...state.userMessages, text] })),
  resetTranscript: () => set({ userMessages: [], assistantText: '', thinkingText: '', streaming: false })
}))
