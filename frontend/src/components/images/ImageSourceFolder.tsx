import { LuChevronDown, LuChevronRight, LuFolder } from 'react-icons/lu'

/**
 * One collapsible folder of thumbnails in the image source browser.
 *
 * A library's tokens are filed into folders for a reason, and a flat grid of a
 * few hundred thumbnails throws that structure away. `showHeading` is false when
 * there is nothing to group by — a campaign's own files, or a search whose
 * matches span many folders — and the tiles then render bare, with no header
 * claiming a structure that isn't there.
 */
export default function ImageSourceFolder({
  label,
  count,
  open,
  onToggle,
  showHeading = true,
  children,
}) {
  const grid = (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))',
        gap: 10,
      }}
    >
      {children}
    </div>
  )

  if (!showHeading) return grid

  return (
    <div style={{ marginBottom: 10 }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          width: '100%',
          padding: '2px 0 6px',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          color: 'var(--text-dim)',
          fontSize: 12,
          textAlign: 'left',
        }}
      >
        {open ? (
          <LuChevronDown size={12} style={{ flexShrink: 0 }} aria-hidden="true" />
        ) : (
          <LuChevronRight size={12} style={{ flexShrink: 0 }} aria-hidden="true" />
        )}
        <LuFolder size={12} style={{ flexShrink: 0 }} aria-hidden="true" />
        <span
          style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}
        >
          {label}
        </span>
        <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>({count})</span>
      </button>
      {open && grid}
    </div>
  )
}
