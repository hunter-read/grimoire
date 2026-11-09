/**
 * A nav group's name above its links. Hidden from assistive tech: the group
 * carries the same name as its label, so it is not read twice.
 */
export default function NavGroupHeader({
  label,
  inset = 14,
}: {
  label: string
  /** Lines the name up with the links' own text. */
  inset?: number
}) {
  return (
    <div
      aria-hidden="true"
      style={{
        padding: `2px ${inset}px 6px`,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--text-muted)',
      }}
    >
      {label}
    </div>
  )
}
