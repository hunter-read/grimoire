import { useNavigate } from 'react-router-dom'
import { tagStyle, displayLabel } from './tagStyle'

/**
 * The clickable tag chip: navigates to the tags page filtered to this tag by its
 * internal key (lowercased label). Kept in its own file so `useNavigate` is only
 * ever invoked for a linkable tag — plain chips never need a Router context.
 */
export default function LinkableTag({ label, color }) {
  const navigate = useNavigate()
  const internal = String(label).trim().toLowerCase()
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        navigate(`/tags?tag=${encodeURIComponent(internal)}`)
      }}
      style={{ ...tagStyle(color), cursor: 'pointer', fontFamily: 'inherit' }}
    >
      {displayLabel(label)}
    </button>
  )
}
