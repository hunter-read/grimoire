import type { CSSProperties, MouseEventHandler, ReactNode } from 'react'

export interface ToolbarButtonProps {
  icon?: ReactNode
  label?: ReactNode
  onClick?: MouseEventHandler<HTMLButtonElement>
  active?: boolean
  disabled?: boolean
  title?: string
  ariaLabel?: string
  ariaPressed?: boolean
  minWidth?: CSSProperties['minWidth']
  style?: CSSProperties
}

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
}: ToolbarButtonProps) {
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
        // A ring drawn with box-shadow, not outline: an inline `outline` would
        // override the stylesheet's :focus-visible ring and leave keyboard
        // users unable to see which button they are on.
        boxShadow: active ? '0 0 0 1px var(--gold-dim)' : undefined,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.4 : 1,
        whiteSpace: 'nowrap',
        boxSizing: 'border-box',
        minWidth,
        transition: 'background-color 0.15s, color 0.15s, box-shadow 0.15s',
        ...style,
      }}
    >
      {icon}
      {label != null && <span>{label}</span>}
    </button>
  )
}
