import { useEffect, useState } from 'react'
import { useKanbanThemeStore } from '../../stores/kanban-theme'
import { useT } from '../../lib/i18n'
import type { Settings } from '../../../../shared/ipc-contracts'
import { KANBAN_BUILTIN_THEMES, KANBAN_DEFAULT_THEME_ID } from '../../../../shared/kanban-theme'
import type { KanbanTheme } from '../../../../shared/kanban-theme'

/** Управление темами канбана: выбор, импорт/экспорт JSON, удаление пользовательских.
 *  Показывается во вкладке «Внешний вид», когда канбан включён. */
export function KanbanThemeSection({
  draft,
  update
}: {
  draft: Settings
  update: (patch: Partial<Settings>) => void
}): React.JSX.Element {
  const t = useT()
  const custom = useKanbanThemeStore((s) => s.custom)
  const loaded = useKanbanThemeStore((s) => s.loaded)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!loaded) void useKanbanThemeStore.getState().load()
  }, [loaded])

  const themes: KanbanTheme[] = [...KANBAN_BUILTIN_THEMES, ...custom]

  const select = (id: string): void => update({ kanbanTheme: id })

  const importThemes = async (): Promise<void> => {
    const result = await useKanbanThemeStore.getState().importThemes()
    if (result === null) return
    if (result.error === 'cancelled') return
    setMessage(result.ok ? t('{imported} imported, {skipped} replaced', { imported: result.imported, skipped: result.skipped }) : result.error ?? '')
  }

  const exportTheme = async (id: string): Promise<void> => {
    const path = await useKanbanThemeStore.getState().exportTheme(id)
    setMessage(path === null ? useKanbanThemeStore.getState().error ?? '' : path)
  }

  const removeTheme = async (id: string): Promise<void> => {
    await useKanbanThemeStore.getState().remove(id)
    if (draft.kanbanTheme === id) update({ kanbanTheme: KANBAN_DEFAULT_THEME_ID })
    setMessage(t('Theme deleted'))
  }

  return (
    <section className="settings-section">
      <h3>{t('Kanban theme')}</h3>
      <div className="kanban-theme-list">
        {themes.map((theme) => (
          <div key={theme.id} className={theme.id === draft.kanbanTheme ? 'kanban-theme current' : 'kanban-theme'}>
            <label className="kanban-theme-pick">
              <input
                type="radio"
                name="kanban-theme"
                checked={theme.id === draft.kanbanTheme}
                onChange={() => select(theme.id)}
              />
              <span className="kanban-theme-preview" style={{ background: theme.columnTint, borderColor: theme.columnBorder }}>
                <span className="kanban-theme-stripe" style={{ background: theme.accents[0] }} />
                <span className="kanban-theme-card" style={{ background: theme.cardTint, borderColor: theme.cardBorder }}>
                  <span className="kanban-theme-dot" style={{ background: theme.accents[1 % theme.accents.length] }} />
                  <span className="kanban-theme-badge" style={{ color: theme.badge }}>💬 3</span>
                </span>
              </span>
              <span className="kanban-theme-name">{theme.name}</span>
            </label>
            <span className="spacer" />
            <button className="ghost" onClick={() => void exportTheme(theme.id)}>{t('Export')}</button>
            {KANBAN_BUILTIN_THEMES.every((builtin) => builtin.id !== theme.id) && (
              <button className="ghost" onClick={() => void removeTheme(theme.id)}>{t('Delete')}</button>
            )}
          </div>
        ))}
      </div>
      <div className="settings-row">
        <button className="ghost" onClick={() => void importThemes()}>{t('Import theme (JSON)…')}</button>
        <button className="ghost" onClick={() => void exportTheme('*')} disabled={custom.length === 0}>
          {t('Export all (JSON)')}
        </button>
        {message !== null && <span className="kanban-theme-message">{message}</span>}
      </div>
      <div className="panel-hint">{t('Kanban themes explanation')}</div>
    </section>
  )
}
