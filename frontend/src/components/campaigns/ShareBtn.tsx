import type { ReactNode } from 'react'

/** Button (or span) used in the guest share modal's action row. */
interface ShareBtnProps {
  children?: ReactNode
  onClick?: () => void
  as?: 'button' | 'span'
}

export default function ShareBtn({ children, onClick, as = 'button' }: ShareBtnProps) {
  const Tag = as
  return (
    <Tag
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '6px 12px',
        background: 'var(--bg-deep)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        color: 'var(--text-dim)',
        cursor: 'pointer',
        fontSize: 13,
      }}
    >
      {children}
    </Tag>
  )
}
