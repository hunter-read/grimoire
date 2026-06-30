import { useTranslation } from 'react-i18next'
import { LuScroll, LuFlame } from 'react-icons/lu'

/** Read-only summary of a user's permission flags, shown in the table row. */
export default function UserPermissionBadges({ allowExplicit, campaignAccess }) {
  const { t } = useTranslation()

  const badges = []
  if (campaignAccess) {
    badges.push({
      key: 'campaigns',
      label: t('users.campaignAccess'),
      icon: <LuScroll size={11} />,
      color: 'var(--gold)',
      bg: 'rgba(200, 160, 80, 0.12)',
      border: 'rgba(200, 160, 80, 0.3)',
    })
  }
  if (allowExplicit) {
    badges.push({
      key: 'explicit',
      label: t('users.explicit'),
      icon: <LuFlame size={11} />,
      color: '#e07070',
      bg: 'rgba(224, 112, 112, 0.12)',
      border: 'rgba(224, 112, 112, 0.3)',
    })
  }

  if (badges.length === 0) {
    return (
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('users.noPermissions')}</span>
    )
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
      {badges.map((b) => (
        <span
          key={b.key}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 11,
            fontWeight: 500,
            padding: '2px 8px',
            borderRadius: 12,
            color: b.color,
            background: b.bg,
            border: `1px solid ${b.border}`,
            whiteSpace: 'nowrap',
          }}
        >
          {b.icon}
          {b.label}
        </span>
      ))}
    </div>
  )
}
