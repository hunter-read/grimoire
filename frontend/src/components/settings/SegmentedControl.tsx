import type { IconType } from 'react-icons'

export interface SegmentedOption<T extends string = string> {
  value: T
  label: string
  icon?: IconType
}

interface Props<T extends string> {
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
}

/** Segmented button group used across the user-preference settings sections. */
export default function SegmentedControl<T extends string>({ options, value, onChange }: Props<T>) {
  return (
    <div
      style={{
        display: 'flex',
        border: '1px solid var(--border)',
        borderRadius: 6,
        overflow: 'hidden',
        width: 'fit-content',
      }}
    >
      {options.map(({ value: v, label, icon: Icon }, idx) => (
        <button
          key={v}
          onClick={() => onChange(v)}
          aria-label={label}
          title={label}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            padding: '7px 18px',
            fontSize: 14,
            cursor: 'pointer',
            border: 'none',
            borderRight: idx < options.length - 1 ? '1px solid var(--border)' : 'none',
            background: value === v ? 'var(--bg-card-hover)' : 'var(--bg-card)',
            color: value === v ? 'var(--gold)' : 'var(--text-dim)',
            transition: 'background 0.15s, color 0.15s',
          }}
        >
          {Icon && <Icon size={15} aria-hidden="true" />}
          {label}
        </button>
      ))}
    </div>
  )
}
