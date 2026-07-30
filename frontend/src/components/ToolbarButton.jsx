/**
 * Shared toolbar button base used across the library/gallery/system toolbars so
 * every page renders consistent controls. Renders an optional leading icon plus
 * a label, with an "active" (gold outline) state and a stable width.
 */
export default function ToolbarButton({
  icon,
  label,
  onClick,
  active = false,
  disabled = false,
  title,
  ariaLabel,
  ariaPressed,
  minWidth,
  style,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: '6px 12px',
        borderRadius: 6,
        fontSize: 13,
        background: active ? 'rgba(180,120,60,0.15)' : 'var(--bg-card)',
        color: active ? 'var(--gold)' : 'var(--text-dim)',
        border: '1px solid var(--border)',
        outline: active ? '1px solid var(--gold-dim)' : 'none',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        whiteSpace: 'nowrap',
        boxSizing: 'border-box',
        minWidth,
        transition: 'all 0.15s',
        ...style,
      }}
    >
      {icon}
      {label != null && <span>{label}</span>}
    </button>
  )
}
