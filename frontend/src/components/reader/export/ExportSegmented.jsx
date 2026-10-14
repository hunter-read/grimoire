import { useRef } from 'react'

/**
 * A row of mutually exclusive choices, drawn like the reader's page/spread/PDF
 * toggle: one bordered group, the chosen segment raised and gold.
 *
 * A radio group to assistive tech, and keyboard-driven like one - arrow keys
 * move the choice, skipping disabled segments, and only the chosen segment is
 * in the tab order.
 *
 * `options`: [{ value, label, Icon?, sub?, disabled?, title? }]. `sub` is a
 * second, quieter line (a resolution's dpi under its name).
 */
export default function ExportSegmented({ options, value, onChange, ariaLabel, iconOnly }) {
  const refs = useRef([])

  const move = (from, dir) => {
    for (let step = 1; step <= options.length; step++) {
      const i = (from + dir * step + options.length) % options.length
      if (!options[i].disabled) {
        onChange(options[i].value)
        refs.current[i]?.focus()
        return
      }
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      style={{
        display: 'flex',
        border: '1px solid var(--border)',
        borderRadius: 6,
        overflow: 'hidden',
      }}
    >
      {options.map((opt, i) => {
        const active = opt.value === value
        const { Icon } = opt
        return (
          <button
            key={opt.value}
            ref={(el) => (refs.current[i] = el)}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={iconOnly ? opt.label : undefined}
            title={opt.title || (iconOnly ? opt.label : undefined)}
            disabled={opt.disabled}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault()
                e.stopPropagation()
                move(i, 1)
              } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault()
                e.stopPropagation()
                move(i, -1)
              }
            }}
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 1,
              padding: opt.sub ? '5px 6px' : '6px 6px',
              border: 'none',
              borderRight: i < options.length - 1 ? '1px solid var(--border)' : 'none',
              background: active ? 'var(--bg-card-hover)' : 'var(--bg-card)',
              color: opt.disabled
                ? 'var(--text-muted)'
                : active
                  ? 'var(--gold)'
                  : 'var(--text-dim)',
              opacity: opt.disabled ? 0.5 : 1,
              cursor: opt.disabled ? 'not-allowed' : 'pointer',
              fontSize: 12,
              fontWeight: active ? 600 : 400,
              transition: 'background 150ms ease-out, color 150ms ease-out',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              {Icon && <Icon size={14} aria-hidden="true" />}
              {!iconOnly && <span>{opt.label}</span>}
            </span>
            {opt.sub && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 400,
                  color: 'var(--text-muted)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {opt.sub}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
