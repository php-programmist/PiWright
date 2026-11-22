import { useEffect } from 'react'

/** Просмотр картинки поверх окна: Esc или клик по оверлею закрывают. */
export function Lightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="lightbox-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <img className="lightbox-image" src={src} alt={alt} />
    </div>
  )
}
