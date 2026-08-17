import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'

/**
 * A panel anchored below a trigger element, portalled to `document.body`.
 *
 * Follows CampaignActionsMenu's shape: fixed positioning recomputed on
 * scroll/resize so an ancestor with `overflow` can't clip it, plus click-outside
 * and Escape to dismiss. Used for the invite and guest panels, which float over
 * the member roster rather than pushing it down inside the fixed-height card.
 *
 * `anchorRef` is the element to align under; `onClose` fires on outside click,
 * Escape, or a viewport change large enough that the anchor is gone.
 */
export default function AnchoredPopover({ anchorRef, onClose, width = 320, children }) {
  const [coords, setCoords] = useState(null)
  const panelRef = useRef(null)

  const place = useCallback(() => {
    const el = anchorRef?.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const margin = 8
    // Right-align to the trigger, then clamp so it stays on screen.
    let left = r.right - width
    left = Math.max(margin, Math.min(left, window.innerWidth - margin - width))
    setCoords({ top: r.bottom + 6, left })
  }, [anchorRef, width])

  useEffect(() => {
    place()
    const onDoc = (e) => {
      if (anchorRef?.current?.contains(e.target) || panelRef.current?.contains(e.target)) return
      onClose?.()
    }
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    const onReposition = () => place()
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
    }
  }, [place, onClose, anchorRef])

  if (!coords) return null

  return createPortal(
    <div
      ref={panelRef}
      style={{
        position: 'fixed',
        top: coords.top,
        left: coords.left,
        zIndex: 2000,
        width,
        maxWidth: 'calc(100vw - 16px)',
        padding: '10px 14px 14px',
        borderRadius: 10,
        background: 'var(--bg-panel)',
        border: '1px solid var(--border)',
        boxShadow: '0 6px 20px var(--shadow)',
      }}
    >
      {children}
    </div>,
    document.body
  )
}
