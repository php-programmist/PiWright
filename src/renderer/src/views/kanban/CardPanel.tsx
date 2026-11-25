import { useEffect, useRef, useState } from 'react'
import type { KanbanBoard, KanbanCommitRef } from '../../../../shared/kanban'
import type { KanbanMutationResult, ProjectEntry } from '../../../../shared/ipc-contracts'
import { base64FromBytes } from '../../../../shared/attachments'
import { useGitLogStore } from '../../stores/gitlog'
import { useTabsStore } from '../../stores/tabs'
import { useTerminalStore } from '../../stores/terminal'
import { persistPanel } from '../../stores/panels-prefs'
import { useLang, useT } from '../../lib/i18n'
import { confirmDialog } from '../../components/ConfirmDialog'
import { Lightbox } from '../../components/Lightbox'
import { RichText, SessionChip } from '../../components/LinkChips'
import { TokenField } from '../../components/TokenField'

/** dataUrl превью по пути вложения — кэш на модуль, чтобы не перечитывать файл. */
const thumbCache = new Map<string, string>()

function KanbanThumb({ project, path, onOpen }: { project: ProjectEntry; path: string; onOpen: (src: string) => void }): React.JSX.Element {
  const [src, setSrc] = useState(() => thumbCache.get(path) ?? '')
  useEffect(() => {
    if (src !== '') return
    let cancelled = false
    void window.piwright.kanbanAttachmentGet(project, path).then((res) => {
      if (cancelled || !res.ok || res.dataUrl === '') return
      thumbCache.set(path, res.dataUrl)
      setSrc(res.dataUrl)
    })
    return () => {
      cancelled = true
    }
  }, [project, path, src])
  if (src === '') return <div className="board-thumb loading" />
  return <img className="board-thumb" src={src} alt={path} onClick={() => onOpen(src)} />
}

/** Чип коммита: первый клик — док «История Git» + выделение коммита, повторный —
 *  дифф первого файла коммита во вкладке. */
function CommitChip({ project, commit, at }: { project: ProjectEntry; commit: KanbanCommitRef; at?: string }): React.JSX.Element {
  const lang = useLang()
  const when = at === undefined ? '' : ` · ${new Date(at).toLocaleString(lang === 'ru' ? 'ru-RU' : 'en-US')}`
  const open = (): void => {
    const gl = useGitLogStore.getState()
    if (!gl.open) {
      if (useTerminalStore.getState().open) {
        useTerminalStore.getState().toggleOpen()
        persistPanel('terminal', { open: false })
      }
      gl.toggleOpen()
      persistPanel('gitlog', { open: true })
    }
    gl.setProject(project)
    void gl.refresh(project)
    if (gl.selectedHash === commit.hash) {
      const file = gl.files[0]
      if (file !== undefined) useTabsStore.getState().openTab(project, { kind: 'diff', path: file.path, hash: commit.hash })
    } else {
      void gl.select(project, commit.hash)
    }
  }
  return (
    <span className="board-chip commit" title={`${commit.message}${when}`} onClick={open}>
      {commit.hash.slice(0, 7)}
    </span>
  )
}

/** Содержимое карточки: заголовок, описание, лента активности, рейл (колонка, вложения,
 *  сессии, коммиты), поле комментария. Общая для модалки на доске и вкладки задачи.
 *  Escape закрывает лайтбокс, иначе вызывает onRequestClose; после удаления карточки — onDeleted. */
export function CardPanel({
  project,
  board,
  cardId,
  apply,
  onError,
  onRequestClose,
  onDeleted,
}: {
  project: ProjectEntry
  board: KanbanBoard
  cardId: string
  apply: (result: KanbanMutationResult) => void
  onError: (message: string) => void
  onRequestClose: () => void
  onDeleted: () => void
}): React.JSX.Element {
  const t = useT()
  const lang = useLang()
  const card = board.cards.find((item) => item.id === cardId)
  const [title, setTitle] = useState(card?.title ?? '')
  const [description, setDescription] = useState(card?.description ?? '')
  const [comment, setComment] = useState('')
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null)
  const [editCommentText, setEditCommentText] = useState('')
  const [pendingImages, setPendingImages] = useState<{ name: string; path: string }[]>([])
  const [lightbox, setLightbox] = useState<string | null>(null)
  const lightboxRef = useRef<string | null>(null)
  const uploadingRef = useRef(false)
  const cardFileRef = useRef<HTMLInputElement | null>(null)
  const commentFileRef = useRef<HTMLInputElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const scrollOnCommentRef = useRef(false)

  useEffect(() => {
    if (!scrollOnCommentRef.current) return
    scrollOnCommentRef.current = false
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight })
  }, [card?.comments.length])

  const setLightboxSafe = (src: string | null): void => {
    lightboxRef.current = src
    setLightbox(src)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (lightboxRef.current !== null) {
        setLightboxSafe(null)
        return
      }
      onRequestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onRequestClose])

  if (card === undefined) return <></>

  const uploadFiles = async (files: File[]): Promise<{ name: string; path: string }[]> => {
    if (uploadingRef.current || files.length === 0) return []
    uploadingRef.current = true
    const uploaded: { name: string; path: string }[] = []
    for (const file of files) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        const res = await window.piwright.kanbanAttachmentPut(project, file.name.length > 0 ? file.name : 'pasted.png', base64FromBytes(bytes))
        if (res.ok) uploaded.push({ name: res.name, path: res.path })
        else onError(res.error ?? 'Upload failed')
      } catch (err) {
        onError(err instanceof Error ? err.message : String(err))
      }
    }
    uploadingRef.current = false
    return uploaded
  }

  const addCardImages = (files: File[]): void => {
    void uploadFiles(files).then((uploaded) => {
      if (uploaded.length === 0) return
      void window.piwright
        .kanbanCardUpdate(project, board.id, { id: card.id, images: [...card.images, ...uploaded.map((item) => item.path)], rev: board.rev })
        .then(apply)
    })
  }

  const removeCardImage = (path: string): void => {
    void window.piwright.kanbanCardUpdate(project, board.id, { id: card.id, images: card.images.filter((item) => item !== path), rev: board.rev }).then(apply)
  }

  const addCommentImages = (files: File[]): void => {
    void uploadFiles(files).then((uploaded) => {
      if (uploaded.length === 0) return
      setPendingImages((prev) => [...prev, ...uploaded])
    })
  }

  const pasteImages = (e: React.ClipboardEvent): void => {
    const files = Array.from(e.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)
    if (files.length === 0) return
    e.preventDefault()
    if (e.target instanceof HTMLTextAreaElement && e.target.classList.contains('board-comment-input')) addCommentImages(files)
    else addCardImages(files)
  }

  const saveDetails = async (): Promise<void> => {
    const nextTitle = title.trim()
    if (nextTitle === card.title && description === card.description) return
    const result = await window.piwright.kanbanCardUpdate(project, board.id, {
      id: card.id,
      ...(nextTitle.length > 0 && nextTitle !== card.title ? { title: nextTitle } : {}),
      ...(description !== card.description ? { description } : {}),
      rev: board.rev,
    })
    apply(result)
  }

  const addComment = async (): Promise<void> => {
    const text = comment.trim()
    if (text.length === 0 && pendingImages.length === 0) return
    setComment('')
    const images = pendingImages.map((item) => item.path)
    setPendingImages([])
    scrollOnCommentRef.current = true
    const result = await window.piwright.kanbanCardComment(project, board.id, { cardId: card.id, text, images })
    apply(result)
  }

  const startEditComment = (item: { id: string; text: string }): void => {
    setEditingCommentId(item.id)
    setEditCommentText(item.text)
  }

  const cancelEditComment = (): void => {
    setEditingCommentId(null)
    setEditCommentText('')
  }

  const saveEditComment = async (): Promise<void> => {
    if (editingCommentId === null) return
    const text = editCommentText.trim()
    if (text.length === 0) return
    const result = await window.piwright.kanbanCommentUpdate(project, board.id, {
      cardId: card.id,
      commentId: editingCommentId,
      text,
      rev: board.rev,
    })
    cancelEditComment()
    apply(result)
  }

  const removeComment = async (commentId: string): Promise<void> => {
    const ok = await confirmDialog({
      message: t('Delete comment?'),
      confirmLabel: t('Delete'),
      danger: true,
    })
    if (!ok) return
    apply(await window.piwright.kanbanCommentDelete(project, board.id, card.id, commentId))
  }

  const moveCardToColumn = (columnId: string): void => {
    if (columnId === card.columnId) return
    void window.piwright.kanbanCardMove(project, board.id, { id: card.id, columnId }).then(apply)
  }

  const removeCard = async (): Promise<void> => {
    const ok = await confirmDialog({
      message: t('Delete card "{title}"?', { title: card.title }),
      confirmLabel: t('Delete'),
      danger: true,
    })
    if (!ok) return
    apply(await window.piwright.kanbanCardDelete(project, board.id, card.id))
    onDeleted()
  }

  const locale = lang === 'ru' ? 'ru-RU' : 'en-US'

  return (
    <div className="board-modal board-card-modal" onPaste={pasteImages}>
      <header className="board-modal-head">
        <input
          className="board-modal-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => void saveDetails()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          }}
        />
        <button className="board-head-danger" title={t('Delete card')} onClick={() => void removeCard()}>
          🗑
        </button>
        <button className="settings-close" title={t('Close')} onClick={onRequestClose}>
          ×
        </button>
      </header>
      <div className="board-card-split">
        <div className="board-modal-body" ref={bodyRef}>
          <div className="board-section-label">{t('Description')}</div>
          <TokenField
            className="board-modal-description"
            project={project}
            placeholder={t('Description')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => void saveDetails()}
          />
          <div className="board-section-label">
            {t('Activity')} <span className="board-section-count">({card.comments.length})</span>
          </div>
          <div className="board-feed">
            {card.comments.map((item) => (
              <div key={item.id} className="board-feed-item">
                <div className={item.author === 'agent' ? 'board-feed-avatar agent' : 'board-feed-avatar user'}>
                  {(item.author === 'agent' ? t('Agent') : t('You')).charAt(0)}
                </div>
                <div className="board-feed-main">
                  <div className="board-feed-head">
                    <span className="board-feed-name">{item.author === 'agent' ? t('Agent') : t('You')}</span>
                    <span className="board-feed-date">{new Date(item.at).toLocaleString(locale)}</span>
                    {item.author === 'user' && editingCommentId !== item.id && (
                      <div className="board-comment-actions">
                        <button title={t('Edit')} onClick={() => startEditComment(item)}>
                          ✏️
                        </button>
                        <button title={t('Delete')} onClick={() => void removeComment(item.id)}>
                          ×
                        </button>
                      </div>
                    )}
                  </div>
                  {editingCommentId === item.id ? (
                    <>
                      <TokenField
                        className="board-comment-edit"
                        project={project}
                        value={editCommentText}
                        autoFocus
                        onChange={(e) => setEditCommentText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.ctrlKey && e.key === 'Enter') void saveEditComment()
                          if (e.key === 'Escape') cancelEditComment()
                        }}
                      />
                      <div className="board-comment-edit-actions">
                        <button className="board-primary" onClick={() => void saveEditComment()}>
                          {t('Save')}
                        </button>
                        <button onClick={cancelEditComment}>{t('Cancel')}</button>
                      </div>
                    </>
                  ) : (
                    <div className="board-comment-text">
                      <RichText text={item.text} project={project} />
                    </div>
                  )}
                  {(item.session !== undefined || (item.commits?.length ?? 0) > 0) && (
                    <div className="board-comment-refs">
                      {item.session !== undefined && <SessionChip project={project} session={item.session} at={item.at} />}
                      {item.commits?.map((commit) => (
                        <CommitChip key={commit.hash} project={project} commit={commit} at={item.at} />
                      ))}
                    </div>
                  )}
                  {item.images.length > 0 && (
                    <div className="board-comment-images">
                      {item.images.map((path) => (
                        <KanbanThumb key={path} project={project} path={path} onOpen={setLightboxSafe} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
        <aside className="board-card-rail">
          <div className="board-rail-section">
            <span className="board-section-label">{t('Column')}</span>
            <select
              className="board-column-select"
              title={t('Move to column')}
              value={card.columnId}
              onChange={(e) => moveCardToColumn(e.target.value)}
            >
              {board.columns.map((column) => (
                <option key={column.id} value={column.id}>
                  {column.name}
                </option>
              ))}
            </select>
          </div>
          <div className="board-rail-section">
            <span className="board-section-label">{t('Attachments')}</span>
            <div className="board-card-images">
              {card.images.map((path) => (
                <div key={path} className="board-thumb-wrap">
                  <KanbanThumb project={project} path={path} onOpen={setLightboxSafe} />
                  <button className="board-thumb-remove" title={t('Remove image')} onClick={() => removeCardImage(path)}>
                    ×
                  </button>
                </div>
              ))}
              <button className="board-thumb-add" title={t('Attach image')} onClick={() => cardFileRef.current?.click()}>
                +
              </button>
            </div>
          </div>
          {(card.sessions?.length ?? 0) > 0 && (
            <div className="board-rail-section">
              <span className="board-section-label">{t('Sessions')}</span>
              <div className="board-comment-refs">
                {card.sessions?.map((item) => (
                  <SessionChip key={item.id} project={project} session={item} at={item.at} />
                ))}
              </div>
            </div>
          )}
          {(card.commits?.length ?? 0) > 0 && (
            <div className="board-rail-section">
              <span className="board-section-label">{t('Commits')}</span>
              <div className="board-comment-refs">
                {card.commits?.map((item) => (
                  <CommitChip key={item.hash} project={project} commit={item} at={item.at} />
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
      <footer className="board-modal-foot">
        {pendingImages.length > 0 && (
          <div className="board-pending-images">
            {pendingImages.map((item) => (
              <span key={item.path} className="board-pending-image" title={item.name}>
                🖼 {item.name}
                <button
                  className="board-pending-remove"
                  title={t('Remove image')}
                  onClick={() => setPendingImages((prev) => prev.filter((p) => p.path !== item.path))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <TokenField
          className="board-comment-input"
          project={project}
          placeholder={t('Add comment')}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.ctrlKey && e.key === 'Enter') void addComment()
          }}
        />
        <div className="board-modal-actions">
          <button className="board-attach" title={t('Attach image')} onClick={() => commentFileRef.current?.click()}>
            📎
          </button>
          <button className="board-primary" onClick={() => void addComment()}>
            {t('Send comment')}
          </button>
        </div>
        <input
          ref={cardFileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            addCardImages(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
        <input
          ref={commentFileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            addCommentImages(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
      </footer>
      {lightbox !== null && <Lightbox src={lightbox} alt="" onClose={() => setLightboxSafe(null)} />}
    </div>
  )
}
