import { useTranslation } from 'react-i18next'

export const ROLE_COLORS = {
  admin: { bg: 'rgba(201, 168, 76, 0.15)', border: 'var(--gold-dim)', text: 'var(--gold)' },
  gm: { bg: 'rgba(212, 145, 58, 0.15)', border: 'var(--amber)', text: 'var(--amber)' },
  player: { bg: 'rgba(154, 142, 126, 0.1)', border: 'var(--border)', text: 'var(--text-dim)' },
}

export default function RoleBadge({ role }) {
  const { t } = useTranslation()
  const c = ROLE_COLORS[role] || ROLE_COLORS.player
  return (
    <span
      style={{
        padding: '3px 10px',
        borderRadius: 20,
        fontSize: 12,
        fontWeight: 500,
        background: c.bg,
        border: `1px solid ${c.border}`,
        color: c.text,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
      }}
    >
      {t(`users.roles.${role}`, { defaultValue: role })}
    </span>
  )
}
