import { useEffect, useId, useRef } from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

interface ConfirmModalProps {
  title: ReactNode
  message: ReactNode
  onConfirm: () => void
  onClose: () => void
  /** What the confirm button says. Name the action ("Remove 3 records"). */
  confirmLabel?: ReactNode
  /** `danger` (the default) for something that can't be taken back. */
  tone?: 'danger' | 'default'
  confirmDisabled?: boolean
  /** Shown between the message and the buttons - a list of what is affected. */
  children?: ReactNode
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Asks before doing something. Focus starts on Cancel, so a stray Enter backs
 * out rather than going ahead, stays inside the dialog while it is open, and
 * goes back to whatever opened it afterwards.
 */
export default function ConfirmModal({
  title,
  message,
  onConfirm,
  onClose,
  confirmLabel,
  tone = 'danger',
  confirmDisabled = false,
  children,
}: ConfirmModalProps) {
  const { t } = useTranslation()
  const titleId = useId()
  const messageId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    cancelRef.current?.focus()
    return () => {
      if (opener && document.contains(opener)) opener.focus()
    }
  }, [])

  // Tab and Shift+Tab wrap around inside the dialog instead of leaving it for
  // the page behind the scrim.
  const trapTab = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab' || !panelRef.current) return
    const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const confirmStyle: CSSProperties =
    tone === 'danger'
      ? { ...buttonBase, background: 'var(--danger-fill)', color: 'var(--on-danger)' }
      : { ...buttonBase, background: 'var(--gold)', color: 'var(--on-accent)' }

  return (
    // The scrim is only a backdrop; the dialog itself is the panel, so a
    // screen reader's dialog boundary matches what is drawn.
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: 'var(--scrim)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      onKeyDown={trapTab}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: 24,
          width: 440,
          maxWidth: '100%',
          maxHeight: '100%',
          overflowY: 'auto',
          boxSizing: 'border-box',
          overflowWrap: 'anywhere',
        }}
      >
        <h2 id={titleId} style={{ marginTop: 0, fontSize: 16, marginBottom: 8 }}>
          {title}
        </h2>
        <div
          id={messageId}
          style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.55 }}
        >
          {message}
        </div>
        {children && <div style={{ marginBottom: 20 }}>{children}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 12 }}>
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            style={{
              ...buttonBase,
              background: 'none',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              fontWeight: 500,
            }}
          >
            {t('common.cancel', 'Cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            style={{
              ...confirmStyle,
              opacity: confirmDisabled ? 0.55 : 1,
              cursor: confirmDisabled ? 'not-allowed' : 'pointer',
            }}
          >
            {confirmLabel ?? t('common.confirm', 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  )
}

const buttonBase: CSSProperties = {
  padding: '8px 16px',
  borderRadius: 6,
  border: 'none',
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 600,
}
