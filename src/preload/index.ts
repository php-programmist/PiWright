/** Единственная точка IPC: типизированный мост через contextBridge. */
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import {
  PI_EVENT_CHANNEL,
  PI_STATUS_CHANNEL,
  SESSION_ABORT_CHANNEL,
  SESSION_PENDING_DIALOGS_CHANNEL,
  SESSION_PROMPT_CHANNEL,
  SESSION_RESPOND_DIALOG_CHANNEL,
  SESSION_SET_MODEL_CHANNEL,
  SESSION_SET_THINKING_CHANNEL,
  SETTINGS_GET_CHANNEL,
  SETTINGS_SET_CHANNEL
} from '../shared/ipc-contracts'
import type { DialogAnswer } from '../shared/agent-events'
import type { PiwrightApi, Settings } from '../shared/ipc-contracts'

function subscribe<T>(channel: string, cb: (value: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, value: T): void => cb(value)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: PiwrightApi = {
  getSettings: () => ipcRenderer.invoke(SETTINGS_GET_CHANNEL),
  setSettings: (patch: Partial<Settings>) => ipcRenderer.invoke(SETTINGS_SET_CHANNEL, patch),
  prompt: (text: string) => ipcRenderer.invoke(SESSION_PROMPT_CHANNEL, text),
  abort: () => ipcRenderer.invoke(SESSION_ABORT_CHANNEL),
  setModel: (key: string) => ipcRenderer.invoke(SESSION_SET_MODEL_CHANNEL, key),
  setThinkingLevel: (level: string) => ipcRenderer.invoke(SESSION_SET_THINKING_CHANNEL, level),
  respondDialog: (id: string, answer: DialogAnswer) => ipcRenderer.invoke(SESSION_RESPOND_DIALOG_CHANNEL, id, answer),
  getPendingDialogs: () => ipcRenderer.invoke(SESSION_PENDING_DIALOGS_CHANNEL),
  onPiEvent: (cb) => subscribe(PI_EVENT_CHANNEL, cb),
  onPiStatus: (cb) => subscribe(PI_STATUS_CHANNEL, cb)
}

contextBridge.exposeInMainWorld('piwright', api)
