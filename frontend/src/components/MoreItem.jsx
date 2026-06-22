import { NavLink } from 'react-router-dom'

export const moreItemStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  padding: '12px 24px',
  fontSize: 16,
  background: 'none',
}

/** A single row in the mobile "More" drawer. */
export default function MoreItem({ to, Icon, label, onClick }) {
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
