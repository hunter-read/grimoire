import { useTranslation } from 'react-i18next'
import { LuKey, LuPencil, LuRefreshCw, LuTrash } from 'react-icons/lu'
import { formatWhen, grantedPermissions } from './apiKeyUtils'

const actionStyle = (danger) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '6px 10px',
  borderRadius: 6,
  fontSize: 13,
  background: 'transparent',
  border: '1px solid var(--border)',
  color: danger ? 'var(--danger)' : 'var(--text-dim)',
  cursor: 'pointer',
})

// One key in the list: never its secret, only the prefix that identifies it.
// `showOwner` is the admin's everyone-view: it names whose key this is and only
// offers Revoke, since nobody may edit or re-mint someone else's key.
export default function ApiKeyRow({
  apiKey,
  permissions,
  showOwner = false,
  onEdit,
  onRegenerate,
  onRevoke,
}) {
  const { t, i18n } = useTranslation()
  const when = (iso) => formatWhen(iso, i18n.language)
  const granted = grantedPermissions(apiKey, permissions)

  const expiry = apiKey.expired
    ? t('appSettings.apiKeys.row.expired', { when: when(apiKey.expires_at) })
    : apiKey.expires_at
      ? t('appSettings.apiKeys.row.expires', { when: when(apiKey.expires_at) })
      : t('appSettings.apiKeys.row.noExpiry')

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        flexWrap: 'wrap',
        padding: '12px 14px',
        borderRadius: 8,
        border: '1px solid var(--border)',
        opacity: apiKey.expired ? 0.75 : 1,
      }}
    >
      <LuKey size={18} style={{ flexShrink: 0, color: 'var(--text-dim)', marginTop: 2 }} />
      <div style={{ flex: '1 1 260px', minWidth: 0 }}>
        <div
          style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
        >
          <span style={{ fontWeight: 600 }}>{apiKey.name}</span>
          {showOwner && (
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              {t('appSettings.apiKeys.row.owner', { name: apiKey.username || apiKey.user_id })}
            </span>
          )}
          <code
            style={{
              fontSize: 12,
              background: 'var(--bg-card)',
              padding: '1px 6px',
              borderRadius: 4,
              color: 'var(--text-dim)',
            }}
          >
            {apiKey.prefix}…
          </code>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4, lineHeight: 1.5 }}>
          {granted.length === 0
            ? t('appSettings.apiKeys.row.noPermissions')
            : granted
                .map(
                  (p) =>
                    `${t(`appSettings.apiKeys.permissions.${p.id === '*' ? 'all' : p.id}.label`, p.id)}: ${t(
                      `appSettings.apiKeys.levels.${p.level}`
                    )}`
                )
                .join(' · ')}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
          {[
            t('appSettings.apiKeys.row.created', { when: when(apiKey.created_at) }),
            apiKey.last_used_at
              ? t('appSettings.apiKeys.row.lastUsed', { when: when(apiKey.last_used_at) })
              : t('appSettings.apiKeys.row.neverUsed'),
          ].join(' · ')}{' '}
          · <span style={{ color: apiKey.expired ? 'var(--danger)' : undefined }}>{expiry}</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {!showOwner && (
          <>
            <button type="button" onClick={() => onEdit(apiKey)} style={actionStyle(false)}>
              <LuPencil size={13} /> {t('appSettings.apiKeys.row.edit')}
            </button>
            <button type="button" onClick={() => onRegenerate(apiKey)} style={actionStyle(false)}>
              <LuRefreshCw size={13} /> {t('appSettings.apiKeys.row.regenerate')}
            </button>
          </>
        )}
        <button type="button" onClick={() => onRevoke(apiKey)} style={actionStyle(true)}>
          <LuTrash size={13} /> {t('appSettings.apiKeys.row.revoke')}
        </button>
      </div>
    </div>
  )
}
