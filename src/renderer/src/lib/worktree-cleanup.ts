/** Закрытие worktree-сессии: если закрылась последняя — предложить удалить worktree (ветку храним).
 *  Порт логики удаления ChatView: обычный remove → при uncommitted переспрос → force. */
import { confirmDialog } from '../components/ConfirmDialog'
import { useChatStore } from '../stores/chat'
import { useSessionsStore } from '../stores/sessions'
import { tFor, type TFunc } from './i18n'
import { sameProjectDir, splitWorktreeHostDir } from '../../../shared/worktree'

function translator(): TFunc {
  return tFor(useSessionsStore.getState().settings?.language ?? 'en')
}

/** Закрыть сессию и убрать её из панели; askCleanup=false — не дергать диалог очистки (массовое закрытие). */
export async function closeSessionAndSweepWorktree(hostId: string, askCleanup = true): Promise<void> {
  const row = useSessionsStore.getState().active.find((r) => r.hostId === hostId)
  const wt = row !== undefined ? splitWorktreeHostDir(row.project.dir) : null
  await window.piwright.closeSession(hostId)
  useChatStore.getState().removeHost(hostId)
  useSessionsStore.getState().forgetHost(hostId)
  if (row === undefined || wt === null || !askCleanup) return
  const stillOpen = useSessionsStore.getState().active.some((r) => {
    const w = splitWorktreeHostDir(r.project.dir)
    return w !== null && w.name === wt.name && sameProjectDir(w.root, wt.root)
  })
  if (stillOpen) return
  const t = translator()
  if (!(await confirmDialog({ message: t("Remove worktree '{name}'? The branch stays.", { name: wt.name }), confirmLabel: t('Delete'), danger: true }))) return
  let result = await window.piwright.worktreeRemove(row.project, wt.name, false)
  if (!result.ok && result.uncommitted && (await confirmDialog({ message: t('There are uncommitted changes. Force remove?') }))) {
    result = await window.piwright.worktreeRemove(row.project, wt.name, true)
  }
  if (!result.ok) window.alert(result.error)
}
