import { useEffect, useRef, useState } from 'react'
import { LuChevronDown } from 'react-icons/lu'

/**
 * A pane-toolbar button that drops a short list of choices beneath itself.
 *
 * Distinct from `MenuSubmenu`, which opens sideways because it is a row *inside*
 * a context menu. This one is anchored to a button in a horizontal toolbar, so
 * it opens downward and closes on outside click and on Escape — the behaviour a
 * toolbar dropdown is expected to have and a nested submenu is not.
 *
 * Used for Upload, whose two choices (files, or a whole folder) are one verb
 * with a variant rather than two separate buttons worth of toolbar width.
 */
export default function ToolbarMenuButton({ label, icon, style, title, testId, children }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    // Pointerdown rather than click, so the menu is already gone by the time a
    // click lands on whatever is underneath it.
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span ref={wrapRef} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        style={style}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={testId}
        onClick={() => setOpen((v) => !v)}
      >
        {icon} {label}
        <LuChevronDown size={11} style={{ opacity: 0.7 }} />
      </button>

      {open && (
        <div
          role="menu"
          data-testid={testId ? `${testId}-panel` : undefined}
          // Any choice closes the menu, so each item is spared its own
          // `setOpen(false)`.
          onClick={() => setOpen(false)}
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: 4,
            minWidth: 190,
            background: 'var(--bg-panel)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 4,
            boxShadow: '0 8px 24px var(--overlay)',
            zIndex: 950,
          }}
        >
          {children}
        </div>
      )}
    </span>
  )
}
