/** Попап веток (референс PHPStorm): поиск, «New branch...», клик по ветке — подменю
 *  (Pin/Unpin / Checkout / Push / Force push / Pull / New Branch from / Rename / Delete; у текущей — без Checkout и Delete).
 *  У веток с upstream — стрелки ahead/behind (зелёная ↑ / синяя ↓, данные с последнего fetch).
 *  Порядок: закреплённые → main/master → алфавит. Живёт в шапке приложения; данные — из git-стора проекта. */
import { useMemo, useState } from 'react'
import { useGitStore } from '../stores/git'
import { useT } from '../lib/i18n'
import { togglePinnedBranch } from '../lib/pinned-branches'
import { sortBranches } from '../../../shared/pinned-branches'
import { projectKey, useSessionsStore } from '../stores/sessions'
import type { ProjectEntry } from '../../../shared/ipc-contracts'

export function BranchSelect({ project, branch, detached }: { project: ProjectEntry; branch: string | null; detached: boolean }): React.JSX.Element {
  const branches = useGitStore((s) => s.branches)
  const busy = useGitStore((s) => s.busy)
  const checkout = useGitStore((s) => s.checkout)
  const renameBranch = useGitStore((s) => s.renameBranch)
  const deleteBranch = useGitStore((s) => s.deleteBranch)
  const branchSync = useGitStore((s) => s.branchSync)
  const pushBranch = useGitStore((s) => s.pushBranch)
  const pullBranch = useGitStore((s) => s.pullBranch)
  const t = useT()
  const settings = useSessionsStore((s) => s.settings)
  const pKey = projectKey(project)
  const pinned = useMemo(() => settings?.pinnedBranches[pKey] ?? [], [settings, pKey])
  const sorted = useMemo(() => sortBranches(branches, pinned), [branches, pinned])
  const syncByName = useMemo(() => new Map(branchSync.map((b) => [b.name, b])), [branchSync])
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
  const filtered = sorted.filter((b) => b.toLowerCase().includes(filter.toLowerCase()))
  const targetSync = target !== null ? syncByName.get(target) : undefined
  // Push: есть что пушить, нет upstream (создастся -u) или upstream удалён на remote.
  const canPush = targetSync === undefined || targetSync.upstream === null || targetSync.gone || targetSync.ahead > 0
  // Pull: есть upstream с отстающими коммитами (gone — тянуть неоткуда).
  const canPull = targetSync !== undefined && targetSync.upstream !== null && !targetSync.gone && targetSync.behind > 0
  // Расхождение (локальные И remote коммиты) — тогда выбор rebase/merge; иначе достаточно fast-forward.
  const diverged = (targetSync?.ahead ?? 0) > 0 && (targetSync?.behind ?? 0) > 0

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
              {filtered.map((b) => {
                const isPinned = pinned.includes(b)
                const sync = syncByName.get(b)
                return (
                  <button
                    key={b}
                    className={`branch-item${b === branch ? ' current' : ''}`}
                    onClick={() => {
                      setTarget(b)
                      setMode('submenu')
                    }}
                  >
                    <span className={`branch-glyph${b === branch ? ' star' : isPinned ? ' pin' : ''}`}>{b === branch ? '★' : isPinned ? '📌' : '⑂'}</span>
                    <span className="branch-item-name">{b}</span>
                    {sync !== undefined && sync.ahead > 0 && (
                      <span className="branch-ab up" title={t('Ahead: {count}', { count: sync.ahead })}>
                        ↑{sync.ahead}
                      </span>
                    )}
                    {sync !== undefined && sync.behind > 0 && (
                      <span className="branch-ab down" title={t('Behind: {count}', { count: sync.behind })}>
                        ↓{sync.behind}
                      </span>
                    )}
                  </button>
                )
              })}
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
          <button
            className="branch-item"
            onClick={() => {
              togglePinnedBranch(project, target)
              close()
            }}
          >
            <span className="branch-glyph">📌</span>
            <span>{pinned.includes(target) ? t('Unpin') : t('Pin')}</span>
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
          {canPush && (
            <>
              <button
                className="branch-item"
                onClick={() => {
                  void pushBranch(project, target, false)
                  close()
                }}
              >
                <span className="branch-glyph up">↑</span>
                <span>{t('Push')}</span>
              </button>
              <button
                className="branch-item"
                onClick={() => {
                  void pushBranch(project, target, true)
                  close()
                }}
              >
                <span className="branch-glyph up">⇧</span>
                <span>{t('Force push (lease)')}</span>
              </button>
            </>
          )}
          {canPull &&
            (target === branch ? (
              diverged ? (
                <>
                  <button
                    className="branch-item"
                    onClick={() => {
                      void pullBranch(project, target, 'rebase')
                      close()
                    }}
                  >
                    <span className="branch-glyph down">↓</span>
                    <span>{t('Pull (rebase)')}</span>
                  </button>
                  <button
                    className="branch-item"
                    onClick={() => {
                      void pullBranch(project, target, 'merge')
                      close()
                    }}
                  >
                    <span className="branch-glyph down">↓</span>
                    <span>{t('Pull (merge)')}</span>
                  </button>
                </>
              ) : (
                <button
                  className="branch-item"
                  onClick={() => {
                    void pullBranch(project, target, 'ff')
                    close()
                  }}
                >
                  <span className="branch-glyph down">↓</span>
                  <span>{t('Pull')}</span>
                </button>
              )
            ) : (
              diverged ? null : (
                <button
                  className="branch-item"
                  onClick={() => {
                    void pullBranch(project, target, 'ff')
                    close()
                  }}
                >
                  <span className="branch-glyph down">↓</span>
                  <span>{t('Pull')}</span>
                </button>
              )
            ))}
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
