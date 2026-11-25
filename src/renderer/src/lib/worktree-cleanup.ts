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

/** Закрыть вкладку сессии. Обычная сессия — отключиться (keepAlive): агент продолжает работать
 *  в фоне, повторное открытие аттачится. Worktree-сессия — остановить процесс: иначе живой
 *  агент держит каталог и `git worktree remove` упадёт. askCleanup=false — не дергать диалог. */
export async function closeSessionAndSweepWorktree(hostId: string, askCleanup = true): Promise<void> {
  const row = useSessionsStore.getState().active.find((r) => r.hostId === hostId)
  const wt = row !== undefined ? splitWorktreeHostDir(row.project.dir) : null
  await window.piwright.closeSession(hostId, wt === null)
  useChatStore.getState().removeHost(hostId)
  useSessionsStore.getState().forgetHost(hostId)
  if (row !== undefined) void useSessionsStore.getState().refreshHistory(row.project)
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

/** «Остановить сессию» — явная остановка: убить процесс агента (в отличие от крестика —
 *  отключиться и оставить агента работать в фоне). */
export async function stopSession(hostId: string): Promise<void> {
  const row = useSessionsStore.getState().active.find((r) => r.hostId === hostId)
  await window.piwright.closeSession(hostId, false)
  useChatStore.getState().removeHost(hostId)
  useSessionsStore.getState().forgetHost(hostId)
  if (row !== undefined) void useSessionsStore.getState().refreshHistory(row.project)
}
