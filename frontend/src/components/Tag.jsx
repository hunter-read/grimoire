export default function Tag({ label, color }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 20,
        background: color || 'var(--tag-bg)',
        border: '1px solid var(--tag-border)',
        fontSize: 14,
        fontWeight: 500,
        color: 'var(--text-dim)',
        marginRight: 6,
        marginBottom: 4,
      }}
    >
      {label ? label.charAt(0).toUpperCase() + label.slice(1) : label}
    </span>
  )
}
