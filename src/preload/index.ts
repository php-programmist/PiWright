/** Единственная точка IPC: типизированный мост через contextBridge. */
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import {
  PI_EVENT_CHANNEL,
  PI_STATUS_CHANNEL,
  SESSION_PROMPT_CHANNEL,
  SETTINGS_GET_CHANNEL,
  SETTINGS_SET_CHANNEL
} from '../shared/ipc-contracts'
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
  onPiEvent: (cb) => subscribe(PI_EVENT_CHANNEL, cb),
  onPiStatus: (cb) => subscribe(PI_STATUS_CHANNEL, cb)
}

contextBridge.exposeInMainWorld('piwright', api)
