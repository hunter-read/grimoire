import { useEffect, useId, useRef, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCircleHelp } from 'react-icons/lu'

/**
 * The "?" beside a file-manager row whose name is not valid UTF-8 (issue #547).
 *
 * Such a row has no actions, and a row that silently ignores every click reads
 * as broken. This says why. The title covers a mouse hover; clicking (or
 * tapping, where there is no hover) opens the same text as a note.
 *
 * The note is positioned `fixed` from the button's rect because the tree is a
 * scrolling, virtualised list that would clip anything absolutely positioned
 * inside a row. For the same reason it closes on scroll rather than drifting
 * away from the row it explains.
 */
export default function UnreadableNameHelp() {
  const { t } = useTranslation()
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const id = useId()
  const text = t('files.unreadableName')

  useEffect(() => {
    if (!anchor) return
    const close = () => setAnchor(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    const onPointer = (e: PointerEvent) => {
      if (!buttonRef.current?.contains(e.target as Node)) close()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('scroll', close, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('scroll', close, true)
    }
  }, [anchor])

  const toggle = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    setAnchor((cur) => (cur ? null : e.currentTarget.getBoundingClientRect()))
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        title={text}
        aria-label={text}
        aria-expanded={!!anchor}
        aria-controls={anchor ? id : undefined}
        data-testid="unreadable-name-help"
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: 0,
          border: 'none',
          background: 'transparent',
          color: 'var(--text-muted)',
          cursor: 'help',
          flexShrink: 0,
        }}
      >
        <LuCircleHelp size={14} aria-hidden="true" />
      </button>
      {anchor && (
        <div
          id={id}
          role="note"
          style={{
            position: 'fixed',
            top: anchor.bottom + 6,
            left: Math.max(8, Math.min(anchor.left - 12, window.innerWidth - 288)),
            width: 280,
            zIndex: 1000,
            padding: '8px 10px',
            fontSize: 12,
            lineHeight: 1.45,
            whiteSpace: 'normal',
            color: 'var(--text)',
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            boxShadow: 'var(--shadow)',
          }}
        >
          {text}
        </div>
      )}
    </>
  )
}
