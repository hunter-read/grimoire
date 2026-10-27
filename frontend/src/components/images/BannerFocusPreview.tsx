import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuMoveVertical } from 'react-icons/lu'

/**
 * Banner preview with a drag-to-reposition control (issue #286).
 *
 * A banner chosen from the library is rarely 2:1, so `object-fit: cover` has to
 * throw away part of it — and by default it throws away the top and bottom,
 * which is exactly where the interesting part of a map or a piece of character
 * art tends to be. Dragging sets `object-position`'s Y as a 0–100 percentage,
 * stored on the campaign so it survives the visit.
 *
 * Dragging is only offered when it would do something: an image at or wider
 * than 2:1 already fits, and there is nothing to slide.
 */
export default function BannerFocusPreview({ src, focusY, onChange, disabled = false }) {
  const { t } = useTranslation()
  const boxRef = useRef(null)
  const [dragging, setDragging] = useState(false)
  // Null until the image loads; drives whether repositioning is offered at all.
  const [canReposition, setCanReposition] = useState(false)

  const setFromClientY = useCallback(
    (clientY) => {
      const box = boxRef.current
      if (!box) return
      const rect = box.getBoundingClientRect()
      if (!rect.height) return
      const pct = ((clientY - rect.top) / rect.height) * 100
      onChange(Math.max(0, Math.min(100, Math.round(pct))))
    },
    [onChange]
  )

  // Tracked on the document so a drag that leaves the box keeps working —
  // releasing outside the preview is the normal way this gesture ends.
  useEffect(() => {
    if (!dragging) return undefined
    const move = (e) => {
      e.preventDefault()
      setFromClientY(e.touches ? e.touches[0].clientY : e.clientY)
    }
    const up = () => setDragging(false)
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
    document.addEventListener('touchmove', move, { passive: false })
    document.addEventListener('touchend', up)
    return () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
      document.removeEventListener('touchmove', move)
      document.removeEventListener('touchend', up)
    }
  }, [dragging, setFromClientY])

  const onImageLoad = (e) => {
    const { naturalWidth: w, naturalHeight: h } = e.target
    // Taller than the 2:1 frame ⇒ cover crops vertically ⇒ Y is meaningful.
    setCanReposition(Boolean(w && h) && h / w > 0.5)
  }

  if (!src) return null

  const active = canReposition && !disabled

  return (
    <div style={{ marginBottom: 16 }}>
      <div
        ref={boxRef}
        data-testid="banner-focus-box"
        onMouseDown={
          active
            ? (e) => {
                e.preventDefault()
                setDragging(true)
                setFromClientY(e.clientY)
              }
            : undefined
        }
        onTouchStart={active ? () => setDragging(true) : undefined}
        style={{
          width: '100%',
          aspectRatio: '2 / 1',
          borderRadius: 10,
          overflow: 'hidden',
          background: 'var(--bg-deep)',
          border: '1px solid var(--border)',
          position: 'relative',
          cursor: active ? (dragging ? 'grabbing' : 'grab') : 'default',
          touchAction: active ? 'none' : undefined,
        }}
      >
        <img
          src={src}
          alt=""
          onLoad={onImageLoad}
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            // `cover` is what the hero itself uses once a focal point is in
            // play, so the preview has to match it to be honest.
            objectFit: 'cover',
            objectPosition: `50% ${focusY}%`,
            display: 'block',
            userSelect: 'none',
          }}
        />
        {active && (
          <div
            style={{
              position: 'absolute',
              bottom: 8,
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '4px 10px',
              borderRadius: 999,
              background: 'var(--scrim)',
              border: '1px solid var(--on-media-border)',
              color: 'var(--on-media)',
              fontSize: 11,
              pointerEvents: 'none',
              opacity: dragging ? 0 : 1,
              backdropFilter: 'blur(2px)',
            }}
          >
            <LuMoveVertical size={11} /> {t('campaignDetail.banner.dragToReposition')}
          </div>
        )}
      </div>
      {active && (
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            marginTop: 8,
            fontSize: 12,
            color: 'var(--text-muted)',
          }}
        >
          {t('campaignDetail.banner.verticalPosition')}
          <input
            type="range"
            min="0"
            max="100"
            value={focusY}
            onChange={(e) => onChange(Number(e.target.value))}
            aria-label={t('campaignDetail.banner.verticalPosition')}
            style={{ flex: 1 }}
          />
        </label>
      )}
    </div>
  )
}
