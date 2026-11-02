/**
 * "3 / 12" counter for a media detail toolbar, telling you where the item you
 * are looking at sits in its folder. Renders nothing for a folder of one, where
 * there is nowhere to navigate and the count is noise.
 *
 * The digits are for the eye; a screen reader gets `label` ("3 of 12") from a
 * polite live region instead, so stepping to the next item says where it landed.
 */
export default function SiblingPosition({
  index,
  total,
  label,
}: {
  index: number
  total: number
  label?: string
}) {
  if (index < 0 || total < 2) return null
  return (
    <span style={{ fontSize: 13, color: 'var(--text-muted)', flexShrink: 0 }}>
      <span aria-hidden="true">
        {index + 1} / {total}
      </span>
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {label || `${index + 1} / ${total}`}
      </span>
    </span>
  )
}
