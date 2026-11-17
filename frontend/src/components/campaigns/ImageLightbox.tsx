import { useRef, useState, type CSSProperties, type TouchEvent } from 'react'
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

/** How far a finger may move and still count as a tap, in CSS pixels. */
const TAP_SLOP = 10

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
 *
 * A touch that pinched or dragged is a gesture, not a tap: the click the
 * browser may still fire when the last finger lifts neither toggles the size
 * nor closes the lightbox.
 */
export default function ImageLightbox({ src, alt = '', onClose }: ImageLightboxProps) {
  const { t } = useTranslation()
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [actualSize, setActualSize] = useState(false)
  useDialogFocus(dialogRef, { onClose, initialFocusRef: closeRef })
  const { imageStyle } = useImageGestures({ containerRef: dialogRef, resetKey: src })
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const gestured = useRef(false)

  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length > 1) {
      gestured.current = true
    } else if (e.touches.length === 1) {
      // A fresh touch forgets the last one; if a second finger lands, the
      // branch above marks it as a pinch.
      gestured.current = false
      touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    }
  }
  const onTouchMove = (e: TouchEvent) => {
    const start = touchStart.current
    if (!start || e.touches.length !== 1) return
    const t = e.touches[0]
    if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > TAP_SLOP) gestured.current = true
  }
  /** Whether this click ends a pinch or a drag; reading it clears the flag. */
  const endsGesture = () => {
    const was = gestured.current
    gestured.current = false
    return was
  }

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
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onClick={(e) => {
        if (e.target === e.currentTarget && !endsGesture()) onClose()
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
          if (e.target === e.currentTarget && !endsGesture()) onClose()
        }}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          onClick={() => {
            if (!endsGesture()) setActualSize((v) => !v)
          }}
          style={{ ...imgStyle, ...imageStyle }}
        />
      </div>
    </div>,
    document.body
  )
}
