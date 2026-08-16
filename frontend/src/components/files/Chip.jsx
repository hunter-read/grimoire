/**
 * Small inline badge used in file listings for container kind, NSFW, indexed
 * state, and missing files.
 */
export default function Chip({ children, tone }) {
  const tones = {
    danger: { bg: 'var(--danger-fill)', fg: 'var(--danger)' },
    accent: { bg: 'var(--bg-card-hover)', fg: 'var(--gold)' },
    default: { bg: 'var(--bg-card)', fg: 'var(--text-dim)' },
  }
  const c = tones[tone] || tones.default
  return (
    <span
      style={{
        fontSize: 10,
        padding: '1px 6px',
        borderRadius: 999,
        background: c.bg,
        color: c.fg,
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  )
}
