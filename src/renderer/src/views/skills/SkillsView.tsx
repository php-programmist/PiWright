/** Навыки проекта: юзерские каталога агента бэкенда + проектные (.pi/skills, .agents/skills),
 *  тогглы через settings.json бэкенда, открытие папки. */
import { useEffect, useState } from 'react'
import { useSessionsStore } from '../../stores/sessions'
import { useT } from '../../lib/i18n'
import type { SkillEntry } from '../../../../shared/ipc-contracts'

export function SkillsView(): React.JSX.Element {
  const activeHostId = useSessionsStore((s) => s.activeHostId)
  const project = useSessionsStore((s) => s.active.find((r) => r.hostId === s.activeHostId)?.project ?? null)
  const t = useT()
  const [skills, setSkills] = useState<SkillEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const reload = async (p: typeof project): Promise<void> => {
    if (p === null) return
    const res = await window.piwright.skillsList(p)
    setSkills(res.ok ? res.skills : [])
    setError(res.ok ? null : res.error)
  }
  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (project === null) return
      const res = await window.piwright.skillsList(project)
      if (cancelled) return
      setSkills(res.ok ? res.skills : [])
      setError(res.ok ? null : res.error)
    })()
    return () => {
      cancelled = true
    }
  }, [project])

  const toggle = async (skill: SkillEntry): Promise<void> => {
    if (project === null) return
    setBusy(skill.path)
    const res = await window.piwright.skillsToggle(project, skill.path, !skill.enabled)
    setBusy(null)
    if (!res.ok) {
      setError(res.error)
      return
    }
    await reload(project)
  }

  if (project === null || activeHostId === null) {
    return (
      <main className="center-view">
        <div className="panel-hint">{t('Pick a session — skills are per-project.')}</div>
      </main>
    )
  }

  return (
    <main className="center-view">
      <header className="center-head">
        <h2>{t('Skills')}</h2>
        <span className="spacer" />
        <button className="ghost" onClick={() => void window.piwright.skillsReveal(project, 'user')}>
          {t('Open user folder')}
        </button>
        <button className="ghost" onClick={() => void window.piwright.skillsReveal(project, 'project')}>
          {t('Open project folder')}
        </button>
      </header>
      <div className="panel-hint">
        {t(
          'User skills of the project backend (~/.pi/agent/skills) and project skills (.pi/skills, .agents/skills). Toggles write into the backend settings.json; new chats pick them up.'
        )}
      </div>
      {error !== null && <div className="settings-error">{error}</div>}
      {skills.length === 0 ? (
        <div className="panel-hint">{t('No skills found.')}</div>
      ) : (
        <div className="server-list">
          {skills.map((skill) => (
            <div key={skill.path} className={`server-card${skill.enabled ? '' : ' off'}`}>
              <div className="server-row">
                <span className="server-name">{skill.name}</span>
                <span className="badge">{skill.source === 'user' ? 'user' : 'project'}</span>
                <span className="spacer" />
                <label className="switch">
                  <input
                    type="checkbox"
                    checked={skill.enabled}
                    disabled={busy === skill.path}
                    onChange={() => void toggle(skill)}
                  />
                  <span />
                </label>
              </div>
              {skill.description.length > 0 && <div className="server-desc">{skill.description}</div>}
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
