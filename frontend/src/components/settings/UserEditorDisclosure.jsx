import { useState } from 'react'
import { LuChevronDown, LuChevronRight } from 'react-icons/lu'
import { fieldLabelStyle } from './EditorField'

/**
 * A collapsible block inside the expanded user editor. Collapsed by default:
 * its body (a campaign list, a link list) is fetched only once it is opened, so
 * expanding a user row stays one request.
 */
export default function UserEditorDisclosure({ icon, label, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          ...fieldLabelStyle,
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          marginBottom: open ? 8 : 0,
        }}
      >
        {open ? <LuChevronDown size={12} /> : <LuChevronRight size={12} />}
        {icon}
        {label}
      </button>
      {open && children}
    </div>
  )
}
