import type { CSSProperties, MouseEventHandler, ReactNode } from 'react'

export interface IconBtnProps {
  onClick?: MouseEventHandler<HTMLButtonElement>
  children?: ReactNode
  title?: string
  active?: boolean
  style?: CSSProperties
}

export default function IconBtn({
  onClick,
  children,
  title,
  active,
  style: extraStyle,
}: IconBtnProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 40,
        height: 40,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 8,
        background: active ? 'var(--bg-card)' : 'transparent',
        color: active ? 'var(--gold)' : 'var(--text-dim)',
        fontSize: 18,
        border: active ? '1px solid var(--border)' : '1px solid transparent',
        ...extraStyle,
      }}
    >
      {children}
    </button>
  )
}
