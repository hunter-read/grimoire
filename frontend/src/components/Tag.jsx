import LinkableTag from './LinkableTag'
import { tagStyle, displayLabel } from './tagStyle'

/**
 * A tag chip. When `linkable` (default) and a label is present, clicking it
 * navigates to the tags page filtered to that tag (issue #235.7): matching is by
 * the tag's internal key, i.e. the lowercased label. Pass `linkable={false}` to
 * render a plain, non-interactive chip (e.g. genres, or inside another clickable
 * card that already handles tag clicks).
 */
export default function Tag({ label, color, linkable = true }) {
  if (linkable && label) {
    return <LinkableTag label={label} color={color} />
  }
  return <span style={tagStyle(color)}>{displayLabel(label)}</span>
}
