import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import useAnchoredMenu from '../../hooks/useAnchoredMenu'

/**
 * A panel anchored below a trigger element, portalled to `document.body`.
 *
 * Follows CampaignActionsMenu's shape: `useAnchoredMenu` keeps it on screen and
 * recomputes on scroll/resize so an ancestor with `overflow` can't clip it, plus
 * click-outside and Escape to dismiss. Used for the invite and guest panels, which float over
 * the member roster rather than pushing it down inside the fixed-height card.
 *
 * `anchorRef` is the element to align under; `onClose` fires on outside click,
 * Escape, or a viewport change large enough that the anchor is gone.
 */
export default function AnchoredPopover({ anchorRef, onClose, width = 320, children }) {
  // The trigger is rendered by the caller, so the hook measures against the ref
  // it passes in rather than one of its own.
  const { panelRef, style } = useAnchoredMenu(true, { width, gap: 6, anchorRef })

  useEffect(() => {
    const onDoc = (e) => {
      if (anchorRef?.current?.contains(e.target) || panelRef.current?.contains(e.target)) return
      onClose?.()
    }
    const onKey = (e) => e.key === 'Escape' && onClose?.()
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose, anchorRef, panelRef])

  return createPortal(
    <div
      ref={panelRef}
      style={{
        ...style,
        zIndex: 2000,
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
