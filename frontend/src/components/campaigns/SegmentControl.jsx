/**
 * Segmented button group (single-select) used in the schedule editor and the
 * embed picker's category tabs.
 *
 * Options share the width evenly by default. Pass `equalWidth={false}` when the
 * option count is open-ended (campaign categories, say) — segments then size to
 * their label and the strip scrolls sideways instead of crushing them.
 *
 * `asTabs` adds tab semantics. It's opt-in because the control is also used for
 * plain single-select choices (a schedule's frequency) that switch a value
 * rather than a panel, where announcing "tab" would mislead.
 */
export default function SegmentControl({
  value,
  options,
  onChange,
  equalWidth = true,
  asTabs = false,
  label,
}) {
  return (
    <div
      role={asTabs ? 'tablist' : undefined}
      aria-label={asTabs ? label : undefined}
      style={{
        display: 'flex',
        background: 'var(--bg-deep)',
        borderRadius: 10,
        padding: 4,
        gap: 2,
        ...(equalWidth ? null : { overflowX: 'auto', scrollbarWidth: 'thin' }),
      }}
    >
      {options.map((o) => (
        <button
          key={o.key}
          role={asTabs ? 'tab' : undefined}
          aria-selected={asTabs ? value === o.key : undefined}
          onClick={() => onChange(o.key)}
          style={{
            flex: equalWidth ? 1 : '0 0 auto',
            whiteSpace: 'nowrap',
            padding: equalWidth ? '7px 4px' : '7px 12px',
            borderRadius: 7,
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 500,
            border: 'none',
            background: value === o.key ? 'var(--bg-card)' : 'transparent',
            color: value === o.key ? 'var(--text)' : 'var(--text-muted)',
            boxShadow: value === o.key ? '0 1px 3px rgba(0,0,0,0.3)' : 'none',
            transition: 'all 0.15s',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
