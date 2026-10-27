import { useTranslation } from 'react-i18next'
import type { Schema } from '../../api'

interface Props {
  user: Schema<'UserOut'>
  onChange: (userId: string, override: string) => unknown
}

/**
 * A user's share-link permission (issue #541): follow their role, or allow or
 * deny it outright. The line under it says what that comes to right now and
 * which layer decided - "Allowed (from role)" for a GM with no override - so an
 * admin never has to work out the effective answer themselves.
 */
export default function ShareLinksPermissionSelect({ user, onChange }: Props) {
  const { t } = useTranslation()
  const value = user.share_links || 'role'
  const allowed = Boolean(user.share_links_allowed)
  const source = user.share_links_source || 'role'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label
        htmlFor={`share-links-${user.id}`}
        style={{ fontSize: 13, color: 'var(--text)', display: 'block' }}
      >
        {t('users.shareLinks.label')}
      </label>
      <select
        id={`share-links-${user.id}`}
        value={value}
        onChange={(e) => onChange(user.id, e.target.value)}
        disabled={source === 'disabled'}
        style={{
          background: 'var(--bg-input)',
          border: '1px solid var(--border)',
          color: 'var(--text)',
          borderRadius: 6,
          padding: '5px 8px',
          fontSize: 13,
          width: '100%',
        }}
      >
        <option value="role">{t('users.shareLinks.followRole')}</option>
        <option value="allow">{t('users.shareLinks.allow')}</option>
        <option value="deny">{t('users.shareLinks.deny')}</option>
      </select>
      <span
        data-testid={`share-links-status-${user.id}`}
        style={{ fontSize: 12, color: allowed ? 'var(--success)' : 'var(--text-muted)' }}
      >
        {t(`users.shareLinks.status.${allowed ? 'allowed' : 'denied'}`)}{' '}
        <span style={{ color: 'var(--text-muted)' }}>{t(`users.shareLinks.source.${source}`)}</span>
      </span>
    </div>
  )
}
