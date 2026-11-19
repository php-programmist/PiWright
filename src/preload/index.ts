/** Единственная точка IPC: типизированный мост через contextBridge. */
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import {
  PI_EVENT_CHANNEL,
  PI_STATUS_CHANNEL,
  SESSION_ABORT_CHANNEL,
  SESSIONS_CHOOSE_DIR_CHANNEL,
  SESSIONS_CLOSE_CHANNEL,
  SESSIONS_DELETE_HISTORY_CHANNEL,
  SESSIONS_HISTORY_CHANNEL,
  SESSIONS_LIST_CHANNEL,
  SESSIONS_NEW_CHANNEL,
  SESSIONS_OPEN_CHANNEL,
  SESSIONS_RENAME_CHANNEL,
  SESSION_PENDING_DIALOGS_CHANNEL,
  SESSION_PROMPT_CHANNEL,
  SESSION_RESPOND_DIALOG_CHANNEL,
  SESSION_SET_MODEL_CHANNEL,
  SESSION_SET_THINKING_CHANNEL,
  SETTINGS_GET_CHANNEL,
  SETTINGS_SET_CHANNEL
} from '../shared/ipc-contracts'
import type { DialogAnswer } from '../shared/agent-events'
import type { BackendMode, PiwrightApi, ProjectEntry, Settings } from '../shared/ipc-contracts'

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
  listSessions: () => ipcRenderer.invoke(SESSIONS_LIST_CHANNEL),
  sessionHistory: (project: ProjectEntry) => ipcRenderer.invoke(SESSIONS_HISTORY_CHANNEL, project),
  newSession: (project: ProjectEntry) => ipcRenderer.invoke(SESSIONS_NEW_CHANNEL, project),
  openSession: (project: ProjectEntry, sessionFile: string) => ipcRenderer.invoke(SESSIONS_OPEN_CHANNEL, project, sessionFile),
  closeSession: (hostId: string) => ipcRenderer.invoke(SESSIONS_CLOSE_CHANNEL, hostId),
  renameSession: (hostId: string, name: string) => ipcRenderer.invoke(SESSIONS_RENAME_CHANNEL, hostId, name),
  deleteHistorySession: (project: ProjectEntry, sessionPath: string) =>
    ipcRenderer.invoke(SESSIONS_DELETE_HISTORY_CHANNEL, project, sessionPath),
  chooseProjectDir: (kind: BackendMode) => ipcRenderer.invoke(SESSIONS_CHOOSE_DIR_CHANNEL, kind),
  prompt: (hostId: string, text: string) => ipcRenderer.invoke(SESSION_PROMPT_CHANNEL, hostId, text),
  abort: (hostId: string) => ipcRenderer.invoke(SESSION_ABORT_CHANNEL, hostId),
  setModel: (hostId: string, key: string) => ipcRenderer.invoke(SESSION_SET_MODEL_CHANNEL, hostId, key),
  setThinkingLevel: (hostId: string, level: string) => ipcRenderer.invoke(SESSION_SET_THINKING_CHANNEL, hostId, level),
  respondDialog: (hostId: string, id: string, answer: DialogAnswer) =>
    ipcRenderer.invoke(SESSION_RESPOND_DIALOG_CHANNEL, hostId, id, answer),
  getPendingDialogs: () => ipcRenderer.invoke(SESSION_PENDING_DIALOGS_CHANNEL),
  onPiEvent: (cb) => subscribe(PI_EVENT_CHANNEL, cb),
  onPiStatus: (cb) => subscribe(PI_STATUS_CHANNEL, cb)
}

contextBridge.exposeInMainWorld('piwright', api)
