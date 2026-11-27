/** Вкладка данных таблицы БД — заглушка (задача 4 добавит грид с пагинацией/фильтрами). */
import { useT } from '../../lib/i18n'
import type { ProjectTab } from '../../stores/tabs'

export function DbTableTab({ tab }: { tab: ProjectTab }): React.JSX.Element {
  const t = useT()
  return (
    <div className="db-table-tab">
      <div className="db-table-tab-head">
        {tab.schema}.{tab.table}
      </div>
      <div className="panel-hint">{t('Table data will appear here')}</div>
    </div>
  )
}
