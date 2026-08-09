import { useNavigate } from 'react-router-dom'
import useLinkProps from '../hooks/useLinkProps'
import { tagStyle, displayLabel } from './tagStyle'

/**
 * The clickable tag chip: navigates to the tags page filtered to this tag by its
 * internal key (lowercased label). Kept in its own file so `useNavigate` is only
 * ever invoked for a linkable tag — plain chips never need a Router context.
 *
 * Tags usually sit inside a clickable card, so the chip stops propagation on
 * every button — including the middle click that opens it in a new tab (issue
 * #313) — to keep the surrounding card from also reacting.
 */
export default function LinkableTag({ label, color }) {
  const navigate = useNavigate()
  const internal = String(label).trim().toLowerCase()
  const to = `/tags?tag=${encodeURIComponent(internal)}`
  const linkProps = useLinkProps(to, (e) => {
    e.stopPropagation()
    navigate(to)
  })
  return (
    <button
      type="button"
      {...linkProps}
      style={{ ...tagStyle(color), cursor: 'pointer', fontFamily: 'inherit' }}
    >
      {displayLabel(label)}
    </button>
  )
}
