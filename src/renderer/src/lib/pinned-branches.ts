/** Пин/анпин ветки проекта: тоггл в settings.pinnedBranches (переживает перезапуск). */
import type { ProjectEntry } from '../../../shared/ipc-contracts'
import { setPinnedBranches } from '../../../shared/pinned-branches'
import { projectKey, useSessionsStore } from '../stores/sessions'

export function togglePinnedBranch(project: ProjectEntry, name: string): void {
  const store = useSessionsStore.getState()
  const settings = store.settings
  if (settings === null) return
  const key = projectKey(project)
  const current = settings.pinnedBranches[key] ?? []
  const next = current.includes(name) ? current.filter((b) => b !== name) : [...current, name]
  void window.piwright.setSettings(setPinnedBranches(settings, key, next)).then((saved) => store.setSettings(saved))
}
