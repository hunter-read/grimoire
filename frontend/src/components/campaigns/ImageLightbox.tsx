import { useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { LuX } from 'react-icons/lu'
import useDialogFocus from '../../hooks/useDialogFocus'
import useImageGestures from '../../hooks/useImageGestures'

interface ImageLightboxProps {
  src: string
  alt?: string
  onClose: () => void
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1000,
  background: 'rgba(0, 0, 0, 0.88)',
  overflow: 'auto',
  overscrollBehavior: 'contain',
}

const closeStyle: CSSProperties = {
  position: 'fixed',
  top: 12,
  right: 12,
  zIndex: 1,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 40,
  height: 40,
  borderRadius: '50%',
  border: 'none',
  background: 'rgba(0, 0, 0, 0.6)',
  color: '#fff',
  cursor: 'pointer',
}

/**
 * A wiki image shown full screen, over the page.
 *
 * The image opens fitted to the viewport; a click on it shows it at its own
 * size (scrollable when larger than the screen) and a second click fits it
 * again. On a phone it pinches to zoom and pans like a map or a token.
 * Escape, the close button or a click on the backdrop closes it.
 */
export default function ImageLightbox({ src, alt = '', onClose }: ImageLightboxProps) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [actualSize, setActualSize] = useState(false)
  useDialogFocus(dialogRef, { onClose, initialFocusRef: closeRef })
  const { imageStyle } = useImageGestures({ containerRef: dialogRef, resetKey: src })

  const imgStyle: CSSProperties = actualSize
    ? { display: 'block', margin: 'auto', maxWidth: 'none', cursor: 'zoom-out' }
    : {
        display: 'block',
        margin: 'auto',
        maxWidth: '100%',
        maxHeight: '100%',
        objectFit: 'contain',
        cursor: 'zoom-in',
      }

  return createPortal(
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-label={alt || t('wiki.embed_image')}
      style={overlayStyle}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <button
        ref={closeRef}
        type="button"
        aria-label={t('common.close')}
        style={closeStyle}
        onClick={onClose}
      >
        <LuX size={22} />
      </button>
      <div
        style={{
          minWidth: '100%',
          minHeight: '100%',
          width: actualSize ? 'max-content' : '100%',
          height: actualSize ? 'max-content' : '100%',
          display: 'flex',
          padding: 16,
          boxSizing: 'border-box',
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          onClick={() => setActualSize((v) => !v)}
          style={{ ...imgStyle, ...imageStyle }}
        />
      </div>
    </div>,
    document.body
  )
}
