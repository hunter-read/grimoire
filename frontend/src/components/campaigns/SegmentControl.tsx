import type { KeyboardEvent, ReactNode } from 'react'

export interface SegmentOption<K extends string = string> {
  key: K
  label: ReactNode
}

interface SegmentControlProps<K extends string> {
  value: K | null | undefined
  options: readonly SegmentOption<K>[]
  onChange: (key: K) => void
  equalWidth?: boolean
  asTabs?: boolean
  label?: string
}

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
 * rather than a panel, where announcing "tab" would mislead. As tabs, only the
 * chosen tab is in the Tab order and the arrow keys (plus Home/End) move between
 * them, choosing as they go; as plain choices each button reports pressed.
 */
export default function SegmentControl<K extends string>({
  value,
  options,
  onChange,
  equalWidth = true,
  asTabs = false,
  label,
}: SegmentControlProps<K>) {
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!asTabs || !options.length) return
    const index = options.findIndex((o) => o.key === value)
    const last = options.length - 1
    const next =
      e.key === 'ArrowRight'
        ? (index + 1) % options.length
        : e.key === 'ArrowLeft'
          ? (index - 1 + options.length) % options.length
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? last
              : -1
    if (next < 0) return
    e.preventDefault()
    onChange(options[next].key)
    e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus()
  }

  return (
    <div
      role={asTabs ? 'tablist' : label ? 'group' : undefined}
      aria-label={label}
      onKeyDown={asTabs ? onTabKey : undefined}
      style={{
        display: 'flex',
        background: 'var(--bg-deep)',
        borderRadius: 10,
        padding: 4,
        gap: 2,
        ...(equalWidth ? null : { overflowX: 'auto' as const, scrollbarWidth: 'thin' as const }),
      }}
    >
      {options.map((o, i) => (
        <button
          key={o.key}
          type="button"
          role={asTabs ? 'tab' : undefined}
          aria-selected={asTabs ? value === o.key : undefined}
          aria-pressed={asTabs ? undefined : value === o.key}
          // As tabs, only the chosen one takes Tab; the arrows reach the rest.
          tabIndex={asTabs ? (value === o.key || (value == null && i === 0) ? 0 : -1) : undefined}
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
            boxShadow: value === o.key ? '0 1px 3px var(--shadow)' : 'none',
            transition: 'background-color 0.15s, color 0.15s, box-shadow 0.15s',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
