import { Link } from 'react-router-dom'
import type { Schema } from '../../api'
import { useAuth } from '../../context/AuthContext'
import { systemDisplayName } from '../../utils/systemDisplayName'

interface BookSystemCrumbProps {
  system?: Schema<'BookSystemRef'> | null
}

/**
 * The `<System> /` crumb in front of a book's title in the reader (issue #641).
 *
 * A book opened from an outside link has no history to go back to, so this is
 * the one way up to its system without hunting through the library. Guests get
 * nothing: they have no system pages, and the link would bounce them to their
 * campaigns.
 */
export default function BookSystemCrumb({ system }: BookSystemCrumbProps) {
  const isGuest = useAuth()?.user?.role === 'guest'
  if (!system || isGuest) return null

  const name = systemDisplayName(system)
  return (
    <>
      {/* Capped so a long system name can't crowd the book title out - both
          ellipsize, but the title keeps most of the room. */}
      <Link
        to={`/library/system/${system.id}`}
        title={name}
        style={{
          fontSize: 15,
          color: 'var(--text-dim)',
          textDecoration: 'none',
          minWidth: 0,
          maxWidth: '40%',
          flexShrink: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </Link>
      <span aria-hidden="true" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
        /
      </span>
    </>
  )
}
