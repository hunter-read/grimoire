import type { CSSProperties, MouseEventHandler } from 'react'
import type { IconType } from 'react-icons'
import { NavLink } from 'react-router-dom'

export const moreItemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  padding: '12px 24px',
  fontSize: 16,
  background: 'none',
}

/** A single row in the mobile "More" drawer. */
export interface MoreItemProps {
  to: string
  Icon: IconType
  label: string
  onClick?: MouseEventHandler<HTMLAnchorElement>
}

export default function MoreItem({ to, Icon, label, onClick }: MoreItemProps) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      style={({ isActive }) => ({
        ...moreItemStyle,
        color: isActive ? 'var(--gold)' : 'var(--text-dim)',
        textDecoration: 'none',
      })}
    >
      <Icon size={18} />
      <span>{label}</span>
    </NavLink>
  )
}
