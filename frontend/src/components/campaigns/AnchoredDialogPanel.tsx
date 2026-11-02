import type { CSSProperties, ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import useDialogFocus from '../../hooks/useDialogFocus'

export interface AnchoredDialogPanelProps {
  /** The panel ref from the caller's `useAnchoredMenu`, which places it. */
  panelRef: RefObject<HTMLDivElement | null>
  style: CSSProperties
  /** The dialog's name ("Change visibility"). */
  label: string
  onClose: () => void
  /** Where focus lands on open; defaults to the first control. */
  initialFocusRef?: RefObject<HTMLElement | null>
  children: ReactNode
}

/**
 * A popover that holds more than menu items - a choice plus a table of
 * checkboxes, say - portalled to the body and positioned by the caller's
 * `useAnchoredMenu`.
 *
 * Its own component so the dialog focus hook runs when it opens and cleans up
 * when it closes: focus moves in, Tab stays inside (it sits at the end of the
 * body, where Tab would otherwise fall off the page), Esc closes, and focus
 * returns to the button that opened it.
 */
export default function AnchoredDialogPanel({
  panelRef,
  style,
  label,
  onClose,
  initialFocusRef,
  children,
}: AnchoredDialogPanelProps) {
  useDialogFocus(panelRef, { onClose, initialFocusRef })
  return createPortal(
    <div ref={panelRef} role="dialog" aria-label={label} style={style}>
      {children}
    </div>,
    document.body
  )
}
