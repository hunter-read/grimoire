import { useRef } from 'react'
import type { KeyboardEvent } from 'react'
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
  /** The id of the visible text naming this choice ("Default view"). */
  labelledBy?: string
  /** A name for the choice when no visible text names it. */
  label?: string
}

/**
 * Segmented button group used across the user-preference settings sections.
 *
 * One choice out of several, so it is a radio group to a screen reader: the
 * picked segment is checked, and only it sits in the Tab order. The arrow keys
 * move to - and pick - the next segment, the way native radio buttons do.
 */
export default function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  labelledBy,
  label,
}: Props<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const current = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  )

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0
    let next = index + step
    if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = options.length - 1
    else if (!step) return
    e.preventDefault()
    next = (next + options.length) % options.length
    onChange(options[next].value)
    refs.current[next]?.focus()
  }

  return (
    <div
      role="radiogroup"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      style={{
        display: 'flex',
        border: '1px solid var(--border-control)',
        borderRadius: 6,
        overflow: 'hidden',
        width: 'fit-content',
      }}
    >
      {options.map(({ value: v, label: text, icon: Icon }, idx) => (
        <button
          key={v}
          ref={(el) => {
            refs.current[idx] = el
          }}
          type="button"
          role="radio"
          aria-checked={value === v}
          tabIndex={idx === current ? 0 : -1}
          onClick={() => onChange(v)}
          onKeyDown={(e) => onKeyDown(e, idx)}
          title={text}
          // The group clips at its rounded edge; the ring is drawn inside.
          className="stretched-control"
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
          {text}
        </button>
      ))}
    </div>
  )
}
