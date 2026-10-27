/**
 * "3 / 12" counter for a media detail toolbar, telling you where the item you
 * are looking at sits in its folder. Renders nothing for a folder of one, where
 * there is nowhere to navigate and the count is noise.
 */
export default function SiblingPosition({ index, total, label }) {
  if (index < 0 || total < 2) return null
  return (
    <span style={{ fontSize: 13, color: 'var(--text-muted)', flexShrink: 0 }} aria-label={label}>
      {index + 1} / {total}
    </span>
  )
}
