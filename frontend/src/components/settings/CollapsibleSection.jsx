import { useState } from 'react'
import { LuChevronDown, LuChevronRight } from 'react-icons/lu'

/**
 * Collapsible wrapper for a settings section: a clickable header (title +
 * optional description) that toggles the body. Open by default; the open/closed
 * state is remembered per-browser under `storageKey` when provided.
 */
export default function CollapsibleSection({
  title,
  description,
  storageKey,
  defaultOpen = true,
  children,
}) {
  const [open, setOpen] = useState(() => {
    if (!storageKey) return defaultOpen
    const saved = localStorage.getItem(storageKey)
    return saved === null ? defaultOpen : saved === '1'
  })

  const toggle = () => {
    setOpen((prev) => {
      const next = !prev
      if (storageKey) localStorage.setItem(storageKey, next ? '1' : '0')
      return next
    })
  }

  return (
    <div style={{ marginBottom: open ? 40 : 12 }}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          textAlign: 'left',
          color: 'var(--text)',
        }}
      >
        {open ? <LuChevronDown size={18} /> : <LuChevronRight size={18} />}
        <span style={{ fontSize: 18, fontWeight: 600 }}>{title}</span>
      </button>
      {open && (
        <div style={{ marginTop: 6 }}>
          {description && (
            <p
              style={{
                fontSize: 14,
                color: 'var(--text-dim)',
                marginBottom: 16,
                lineHeight: 1.6,
              }}
            >
              {description}
            </p>
          )}
          {children}
        </div>
      )}
    </div>
  )
}
