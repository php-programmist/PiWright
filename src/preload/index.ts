/** Единственная точка IPC: типизированный мост через contextBridge. */
import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import {
  FILES_CHANGED_CHANNEL,
  FILES_LIST_CHANNEL,
  FILES_READ_CHANNEL,
  FILES_WATCH_CHANNEL,
  GIT_BRANCHES_CHANNEL,
  GIT_CHECKOUT_CHANNEL,
  GIT_COMMIT_CHANNEL,
  GIT_FILE_DIFF_CHANNEL,
  GIT_GENERATE_MESSAGE_CHANNEL,
  GIT_LOG_CHANNEL,
  GIT_PUSH_CHANNEL,
  GIT_STAGE_CHANNEL,
  GIT_STATUS_CHANNEL,
  GIT_UNSTAGE_CHANNEL,
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
  SETTINGS_SET_CHANNEL,
  TERM_CLOSE_CHANNEL,
  TERM_CREATE_CHANNEL,
  TERM_DATA_CHANNEL,
  TERM_EXIT_CHANNEL,
  TERM_INPUT_CHANNEL,
  TERM_PROFILES_CHANNEL,
  TERM_RESIZE_CHANNEL
} from '../shared/ipc-contracts'
import type { DialogAnswer } from '../shared/agent-events'
import type { BackendMode, PiwrightApi, ProjectEntry, Settings, TerminalProfileId } from '../shared/ipc-contracts'

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
  gitStatus: (project) => ipcRenderer.invoke(GIT_STATUS_CHANNEL, project),
  gitFileDiff: (project, path) => ipcRenderer.invoke(GIT_FILE_DIFF_CHANNEL, project, path),
  gitStage: (project, paths) => ipcRenderer.invoke(GIT_STAGE_CHANNEL, project, paths),
  gitUnstage: (project, paths) => ipcRenderer.invoke(GIT_UNSTAGE_CHANNEL, project, paths),
  gitCommit: (project, message) => ipcRenderer.invoke(GIT_COMMIT_CHANNEL, project, message),
  gitPush: (project) => ipcRenderer.invoke(GIT_PUSH_CHANNEL, project),
  gitLog: (project) => ipcRenderer.invoke(GIT_LOG_CHANNEL, project),
  gitBranches: (project) => ipcRenderer.invoke(GIT_BRANCHES_CHANNEL, project),
  gitCheckout: (project, name, create) => ipcRenderer.invoke(GIT_CHECKOUT_CHANNEL, project, name, create),
  gitGenerateMessage: (project) => ipcRenderer.invoke(GIT_GENERATE_MESSAGE_CHANNEL, project),
  filesList: (project, dir) => ipcRenderer.invoke(FILES_LIST_CHANNEL, project, dir),
  filesRead: (project, path) => ipcRenderer.invoke(FILES_READ_CHANNEL, project, path),
  filesWatch: (project, paths) => ipcRenderer.invoke(FILES_WATCH_CHANNEL, project, paths),
  termProfiles: (project) => ipcRenderer.invoke(TERM_PROFILES_CHANNEL, project),
  termCreate: (project, profileId: TerminalProfileId | null) => ipcRenderer.invoke(TERM_CREATE_CHANNEL, project, profileId),
  termClose: (id: string) => ipcRenderer.invoke(TERM_CLOSE_CHANNEL, id),
  termInput: (id: string, data: string) => ipcRenderer.send(TERM_INPUT_CHANNEL, id, data),
  termResize: (id: string, cols: number, rows: number) => ipcRenderer.send(TERM_RESIZE_CHANNEL, id, cols, rows),
  onPiEvent: (cb) => subscribe(PI_EVENT_CHANNEL, cb),
  onPiStatus: (cb) => subscribe(PI_STATUS_CHANNEL, cb),
  onFilesChanged: (cb) => subscribe(FILES_CHANGED_CHANNEL, cb),
  onTermData: (cb) => subscribe(TERM_DATA_CHANNEL, cb),
  onTermExit: (cb) => subscribe(TERM_EXIT_CHANNEL, cb)
}

contextBridge.exposeInMainWorld('piwright', api)
