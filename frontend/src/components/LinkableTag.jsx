import { Link } from 'react-router-dom'
import { tagStyle, displayLabel } from './tagStyle'

/**
 * The clickable tag chip: a real link to the tags page filtered to this tag by
 * its internal key (lowercased label). Kept in its own file so the router link
 * is only ever rendered for a linkable tag — plain chips never need a Router
 * context.
 *
 * Tags usually sit inside a card covered by a CardLink overlay; being
 * positioned keeps the chip painted above the overlay so it stays clickable.
 */
export default function LinkableTag({ label, color }) {
  const internal = String(label).trim().toLowerCase()
  return (
    <Link
      to={`/tags?tag=${encodeURIComponent(internal)}`}
      style={{
        ...tagStyle(color),
        position: 'relative',
        cursor: 'pointer',
        textDecoration: 'none',
      }}
    >
      {displayLabel(label)}
    </Link>
  )
}
