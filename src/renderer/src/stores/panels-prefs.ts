/** Состояние правых панелей (git/files/terminal) переживает перезапуск: hydrate — один раз при
 *  загрузке настроек, persist — из компонентов (клик по кнопке панели, mouseup ресайза).
 *  Git и Files взаимоисключающие (фича 24): гонка двух параллельных setSettings перетирала
 *  merge (в файле оказывались обе панели открытыми) — запись сериализуется цепочкой,
 *  hydrate наводит эксклюзивность (обе открыты → остаётся git). */
import type { PanelName, PanelPrefs, Settings } from '../../../shared/ipc-contracts'
import { mergePanelPrefs } from '../../../shared/panel-prefs'
import { useSessionsStore } from './sessions'
import { useGitStore } from './git'
import { useFilesStore } from './files'
import { useTerminalStore } from './terminal'
import { useGitLogStore } from './gitlog'
import { useKanbanStore } from './kanban'

let persistChain: Promise<void> = Promise.resolve()

export function persistPanel(panel: PanelName, patch: PanelPrefs): void {
  persistChain = persistChain
    .then(async () => {
      const settings = useSessionsStore.getState().settings
      if (settings === null) return
      const saved = await window.piwright.setSettings(mergePanelPrefs(settings, panel, patch))
      useSessionsStore.getState().setSettings(saved)
    })
    .catch(() => {})
}

export function hydratePanels(settings: Settings): void {
  const { git, files, terminal, gitlog, kanban, sessions } = settings.panels
  if (git !== undefined) useGitStore.setState({ ...(git.open !== undefined ? { open: git.open } : {}), ...(git.width !== undefined ? { width: git.width } : {}) })
  if (files !== undefined) useFilesStore.setState({ ...(files.open !== undefined ? { open: files.open } : {}), ...(files.width !== undefined ? { width: files.width } : {}) })
  if (terminal !== undefined)
    useTerminalStore.setState({
      ...(terminal.open !== undefined ? { open: terminal.open } : {}),
      ...(terminal.height !== undefined ? { height: terminal.height } : {})
    })
  if (gitlog !== undefined)
    useGitLogStore.setState({
      ...(gitlog.open !== undefined ? { open: gitlog.open } : {}),
      ...(gitlog.height !== undefined ? { height: gitlog.height } : {})
    })
  if (kanban !== undefined)
    useKanbanStore.setState({
      ...(kanban.open !== undefined ? { open: kanban.open } : {}),
      ...(kanban.width !== undefined ? { width: kanban.width } : {})
    })
  if (sessions !== undefined)
    useSessionsStore.setState({
      ...(sessions.width !== undefined ? { sidebarWidth: sessions.width } : {}),
      ...(sessions.open !== undefined ? { sidebarCollapsed: !sessions.open } : {})
    })
  // Эксклюзивность git/files: обе открыты в сохранённых настройках → остаётся git.
  if ((git?.open ?? false) && (files?.open ?? false)) {
    useFilesStore.setState({ open: false })
    persistPanel('files', { open: false })
  }
  // Канбан делит правый рельс с git/files: git вытесняет канбан, канбан — files.
  if ((kanban?.open ?? false) && (git?.open ?? false)) {
    useKanbanStore.setState({ open: false })
    persistPanel('kanban', { open: false })
  } else if ((kanban?.open ?? false) && (files?.open ?? false)) {
    useFilesStore.setState({ open: false })
    persistPanel('files', { open: false })
  }
  // Эксклюзивность терминал/gitlog: оба открыты → остаётся терминал.
  if ((terminal?.open ?? false) && (gitlog?.open ?? false)) {
    useGitLogStore.setState({ open: false })
    persistPanel('gitlog', { open: false })
  }
}
