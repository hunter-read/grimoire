/**
 * A nav group's name above its links. Hidden from assistive tech: the group
 * carries the same name as its label, so it is not read twice.
 */
export default function NavGroupHeader({
  label,
  badge,
  inset = 14,
}: {
  label: string
  /** A quieter note after the name, such as "Beta" for a group still settling in. */
  badge?: string
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
      {badge ? (
        <span style={{ marginLeft: 6, fontWeight: 500, letterSpacing: '0.06em', opacity: 0.75 }}>
          ({badge})
        </span>
      ) : null}
    </div>
  )
}
