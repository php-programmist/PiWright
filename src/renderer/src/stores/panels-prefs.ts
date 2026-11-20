/** Состояние правых панелей (git/files/terminal) переживает перезапуск: hydrate — один раз при
 *  загрузке настроек, persist — из компонентов (клик по кнопке панели, mouseup ресайза). */
import type { PanelName, PanelPrefs, Settings } from '../../../shared/ipc-contracts'
import { mergePanelPrefs } from '../../../shared/panel-prefs'
import { useSessionsStore } from './sessions'
import { useGitStore } from './git'
import { useFilesStore } from './files'
import { useTerminalStore } from './terminal'

export function persistPanel(panel: PanelName, patch: PanelPrefs): void {
  const settings = useSessionsStore.getState().settings
  if (settings === null) return
  void window.piwright.setSettings(mergePanelPrefs(settings, panel, patch)).then((saved) => {
    useSessionsStore.getState().setSettings(saved)
  })
}

export function hydratePanels(settings: Settings): void {
  const { git, files, terminal } = settings.panels
  if (git !== undefined) useGitStore.setState({ ...(git.open !== undefined ? { open: git.open } : {}), ...(git.width !== undefined ? { width: git.width } : {}) })
  if (files !== undefined) useFilesStore.setState({ ...(files.open !== undefined ? { open: files.open } : {}), ...(files.width !== undefined ? { width: files.width } : {}) })
  if (terminal !== undefined) useTerminalStore.setState({ ...(terminal.open !== undefined ? { open: terminal.open } : {}), ...(terminal.width !== undefined ? { width: terminal.width } : {}) })
}
