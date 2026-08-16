import { useRef, useState } from 'react'
import { LuChevronRight } from 'react-icons/lu'

/**
 * A context-menu row that opens a nested panel of choices on hover or click.
 *
 * The file menu accumulated enough options — rename, new folder, four pin
 * edges, six container kinds, NSFW, metadata, delete — that a flat list became
 * a wall to read past. Grouping the multi-choice sets behind one row each keeps
 * the top level to a scannable set of verbs.
 *
 * Opens on hover (with a small close delay so the diagonal move to the submenu
 * doesn't dismiss it) and on click, so it works for pointer and keyboard alike.
 */
export default function MenuSubmenu({ label, icon, children, itemStyle, hoverProps, testId }) {
  const [open, setOpen] = useState(false)
  const closeTimer = useRef(null)

  const cancelClose = () => clearTimeout(closeTimer.current)
  // Leaving the row briefly crosses dead space on the way to the panel; closing
  // instantly would make the submenu unreachable by a diagonal mouse path.
  const scheduleClose = () => {
    cancelClose()
    closeTimer.current = setTimeout(() => setOpen(false), 180)
  }

  return (
    <div
      style={{ position: 'relative' }}
      onMouseEnter={() => {
        cancelClose()
        setOpen(true)
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        style={{ ...itemStyle, justifyContent: 'space-between' }}
        {...hoverProps}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={testId}
        onClick={(e) => {
          e.stopPropagation()
          // Open, never toggle. Hovering the row already opened the panel, so a
          // toggle here would close it on the very click meant to commit to it —
          // which is what a pointer user does naturally, and what a click
          // without a preceding hover (keyboard, touch) still needs to open.
          setOpen(true)
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {icon}
          {label}
        </span>
        <LuChevronRight size={12} style={{ opacity: 0.7 }} />
      </button>

      {open && (
        <div
          role="menu"
          data-testid={testId ? `${testId}-panel` : undefined}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          style={{
            position: 'absolute',
            top: -4,
            left: '100%',
            marginLeft: 2,
            minWidth: 200,
            background: 'var(--bg-panel)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 4,
            boxShadow: '0 8px 24px var(--overlay)',
            zIndex: 1,
          }}
        >
          {children}
        </div>
      )}
    </div>
  )
}
