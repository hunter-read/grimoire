import { useId } from 'react'
import { LuChevronRight } from 'react-icons/lu'
import { sectionTitleStyle } from './ui'

/**
 * One collapsible block of the editor sidebar.
 *
 * The sidebar stacks six unrelated things — tool help, layer counts, grid,
 * selection, player view, environment — and with all of them always expanded
 * the panel below the one you are using shifts every time the one above it
 * changes size. Selecting a light is the worst case: the selection block grows
 * by a whole property form and shoves everything under it down the panel, with
 * no animation to explain where it went.
 *
 * Collapsing is the fix, and it needs to be per-section and remembered by the
 * caller, so a user who never wants to see the layer counts can put them away
 * for good.
 *
 * The header is a real `<button>` with `aria-expanded`, not a styled div: this
 * is the one control in the panel that is pure disclosure, and it has to be
 * reachable by keyboard and announced as expandable.
 *
 * `count` renders a quiet tally on the right, so a collapsed section can still
 * say how much it is hiding.
 */
export default function SidebarSection({
  title,
  count,
  open,
  onToggle,
  children,
  'data-testid': testId,
}) {
  const bodyId = useId()

  return (
    <div data-testid={testId}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={bodyId}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          padding: 0,
          border: 'none',
          background: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          // The title already carries the sidebar's section styling; the
          // button only adds the affordance around it.
          ...sectionTitleStyle,
          marginBottom: open ? 10 : 0,
        }}
      >
        <LuChevronRight
          size={12}
          aria-hidden="true"
          style={{
            flexShrink: 0,
            // Rotation rather than a second icon, so the arrow visibly turns
            // instead of swapping. The transition is the only motion in the
            // panel and exists because an instant jump is what made the old
            // layout feel abrupt.
            transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform 120ms ease',
          }}
        />
        <span style={{ flex: 1 }}>{title}</span>
        {count != null && (
          <span style={{ color: 'var(--text-muted)', letterSpacing: 0 }}>{count}</span>
        )}
      </button>
      {/* Unmounted rather than hidden when closed: these bodies hold live
          inputs, and leaving a collapsed property form in the tab order is a
          keyboard trap with no visible focus. */}
      {open && <div id={bodyId}>{children}</div>}
    </div>
  )
}
