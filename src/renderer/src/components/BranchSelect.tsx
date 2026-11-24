/** Попап веток (референс PHPStorm): поиск, «New branch...», клик по ветке — подменю
 *  (Checkout / New Branch from / Rename / Delete; у текущей — без Checkout и Delete).
 *  Живёт в шапке приложения и в шапке git-панели; данные — из git-стора проекта. */
import { useState } from 'react'
import { useGitStore } from '../stores/git'
import { useT } from '../lib/i18n'
import type { ProjectEntry } from '../../../shared/ipc-contracts'

export function BranchSelect({ project, branch, detached }: { project: ProjectEntry; branch: string | null; detached: boolean }): React.JSX.Element {
  const branches = useGitStore((s) => s.branches)
  const busy = useGitStore((s) => s.busy)
  const checkout = useGitStore((s) => s.checkout)
  const renameBranch = useGitStore((s) => s.renameBranch)
  const deleteBranch = useGitStore((s) => s.deleteBranch)
  const t = useT()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'list' | 'submenu' | 'new' | 'rename'>('list')
  const [target, setTarget] = useState<string | null>(null)
  const [startFrom, setStartFrom] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [name, setName] = useState('')

  if (branch === null || detached) return <span className="git-branch">detached</span>

  const close = (): void => {
    setOpen(false)
    setMode('list')
    setTarget(null)
    setStartFrom(null)
    setFilter('')
    setName('')
  }
  const filtered = branches.filter((b) => b.toLowerCase().includes(filter.toLowerCase()))

  const createBranch = (): void => {
    const trimmed = name.trim()
    if (trimmed.length === 0) return
    void checkout(project, trimmed, true, startFrom ?? undefined)
    close()
  }

  return (
    <div className="branch-wrap">
      {/* Клик по имени ветки при открытом попапе НЕ закрывает его (баг 10): кнопка поднята над
          оверлеем и в открытом состоянии игнорирует клики; закрытие — клик мимо попапа/Escape. */}
      <button
        className={`branch-toggle${open ? ' raised' : ''}`}
        disabled={busy}
        title={branch}
        onClick={() => {
          if (!open) setOpen(true)
        }}
      >
        <svg className="branch-icon" width="12" height="12" viewBox="0 0 24 24" aria-hidden="true">
          <line x1="6" y1="3" x2="6" y2="15" stroke="currentColor" strokeWidth="2" />
          <circle cx="18" cy="6" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle cx="6" cy="18" r="3" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M18 9a9 9 0 0 1-9 9" fill="none" stroke="currentColor" strokeWidth="2" />
        </svg>
        <span className="branch-toggle-name">{branch}</span>
        <span className="branch-chevron">▾</span>
      </button>
      {open && <div className="popup-overlay" onClick={close} />}
      {open && mode !== 'rename' && (
        <div className="branch-popup">
          {(mode === 'list' || mode === 'submenu') && (
            <>
              <input
                className="branch-search"
                autoFocus
                placeholder={t('Search branches')}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') close()
                }}
              />
              <button
                className="branch-item"
                onClick={() => {
                  setStartFrom(null)
                  setName('')
                  setMode('new')
                }}
              >
                <span className="branch-glyph">+</span>
                <span>{t('New branch...')}</span>
              </button>
              {filtered.map((b) => (
                <button
                  key={b}
                  className={`branch-item${b === branch ? ' current' : ''}`}
                  onClick={() => {
                    setTarget(b)
                    setMode('submenu')
                  }}
                >
                  <span className={`branch-glyph${b === branch ? ' star' : ''}`}>{b === branch ? '★' : '⑂'}</span>
                  <span className="branch-item-name">{b}</span>
                </button>
              ))}
              {filtered.length === 0 && <div className="panel-hint">{t('no branches')}</div>}
            </>
          )}
          {mode === 'new' && (
            <input
              className="branch-search"
              autoFocus
              value={name}
              placeholder={startFrom !== null ? t('new branch from {name}', { name: startFrom }) : t('new branch name')}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') createBranch()
                if (e.key === 'Escape') {
                  setMode('list')
                  setName('')
                }
              }}
              onBlur={createBranch}
            />
          )}
        </div>
      )}
      {open && mode === 'submenu' && target !== null && (
        <div className="branch-sub">
          <button className="branch-item back" onClick={() => setMode('list')}>
            <span className="branch-glyph">‹</span>
            <span className="branch-item-name">{target}</span>
          </button>
          {target !== branch && (
            <button
              className="branch-item"
              onClick={() => {
                void checkout(project, target, false)
                close()
              }}
            >
              <span className="branch-glyph" />
              <span>{t('Checkout')}</span>
            </button>
          )}
          <button
            className="branch-item"
            onClick={() => {
              setStartFrom(target)
              setName('')
              setMode('new')
            }}
          >
            <span className="branch-glyph" />
            <span>{t('New Branch from {name}...', { name: target })}</span>
          </button>
          <button
            className="branch-item"
            onClick={() => {
              setName(target)
              setMode('rename')
            }}
          >
            <span className="branch-glyph" />
            <span>{t('Rename...')}</span>
          </button>
          {target !== branch && (
            <button
              className="branch-item danger"
              onClick={() => {
                void deleteBranch(project, target)
                close()
              }}
            >
              <span className="branch-glyph" />
              <span>{t('Delete')}</span>
            </button>
          )}
        </div>
      )}
      {open && mode === 'rename' && target !== null && (
        <div className="branch-sub">
          <div className="branch-rename-head">{t('Rename {name}', { name: target })}</div>
          <input
            className="branch-search"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const to = name.trim()
                if (to.length > 0 && to !== target) void renameBranch(project, target, to)
                close()
              }
              if (e.key === 'Escape') setMode('submenu')
            }}
          />
        </div>
      )}
    </div>
  )
}
