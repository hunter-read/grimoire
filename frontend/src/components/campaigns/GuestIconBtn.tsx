/** Small icon-only action button used in the guest list rows. */
import type { MouseEventHandler, ReactNode } from 'react'

interface GuestIconBtnProps {
  children?: ReactNode
  title?: string
  /** The spoken name, when it should say more than the tooltip (which guest). */
  label?: string
  onClick?: MouseEventHandler<HTMLButtonElement>
  disabled?: boolean
}

export default function GuestIconBtn({
  children,
  title,
  label,
  onClick,
  disabled,
}: GuestIconBtnProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={label ?? title}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: 6,
        background: 'var(--bg-deep)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        color: 'var(--text-dim)',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {children}
    </button>
  )
}
