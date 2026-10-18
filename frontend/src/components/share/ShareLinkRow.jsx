import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCircleCheck, LuLink, LuLock, LuBan, LuTrash2, LuFileImage } from 'react-icons/lu'
import ShareLinkStateBadge from './ShareLinkStateBadge'
import { copyText, formatWhen, publicUrl } from './shareLinkUtils'

const actionStyle = (danger) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '4px 9px',
  borderRadius: 6,
  fontSize: 12,
  background: 'transparent',
  border: '1px solid var(--border)',
  color: danger ? 'var(--danger)' : 'var(--text-dim)',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
})

/**
 * One share link. `showItem` names what it points at (lists spanning many
 * items); `showOwner` names whose it is (the admin's view of other users).
 *
 * The direct file URL is offered only for links without a password: a tool
 * loading it has no way to type one, so for a protected link it cannot work.
 */
export default function ShareLinkRow({
  link,
  showItem = false,
  showOwner = false,
  onRevoke,
  onDelete,
}) {
  const { t, i18n } = useTranslation()
  const [copied, setCopied] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const when = (iso) => formatWhen(iso, i18n.language)
  const revoked = link.state === 'revoked'

  const copy = async (which, text) => {
    if (await copyText(text)) {
      setCopied(which)
      setTimeout(() => setCopied(null), 1800)
    }
  }

  const title = showItem ? link.resource_name || link.filename : link.label || link.filename
  const subtitle = showItem && link.label ? link.label : null
  const details = [
    showItem && t(`share.type.${link.resource_type}`),
    link.expires_at
      ? t('share.row.expires', { when: when(link.expires_at) })
      : t('share.row.noExpiry'),
    t('share.row.uses', { count: link.use_count }),
    link.last_used_at && t('share.row.lastUsed', { when: when(link.last_used_at) }),
  ].filter(Boolean)

  return (
    <li
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 10,
        padding: '10px 12px',
        borderRadius: 8,
        border: '1px solid var(--border)',
        background: 'var(--bg-card)',
        opacity: link.state === 'active' ? 1 : 0.8,
      }}
    >
      <div style={{ flex: '1 1 220px', minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '100%',
            }}
          >
            {title}
          </span>
          <ShareLinkStateBadge state={link.state} />
          {link.has_password && (
            <LuLock
              size={12}
              aria-label={t('share.row.passwordProtected')}
              title={t('share.row.passwordProtected')}
              style={{ color: 'var(--text-dim)' }}
            />
          )}
          {showOwner && link.username && (
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              {t('share.row.owner', { name: link.username })}
            </span>
          )}
        </div>
        {subtitle && <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>{subtitle}</div>}
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
          {details.join(' · ')}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {!revoked && link.url && (
          <button
            type="button"
            onClick={() => copy('page', publicUrl(link.url))}
            style={actionStyle()}
          >
            {copied === 'page' ? <LuCircleCheck size={12} /> : <LuLink size={12} />}
            {copied === 'page' ? t('share.row.copied') : t('share.row.copyLink')}
          </button>
        )}
        {!revoked && link.file_url && !link.has_password && (
          <button
            type="button"
            onClick={() => copy('file', publicUrl(link.file_url))}
            title={t('share.row.copyFileHint')}
            style={actionStyle()}
          >
            {copied === 'file' ? <LuCircleCheck size={12} /> : <LuFileImage size={12} />}
            {copied === 'file' ? t('share.row.copied') : t('share.row.copyFile')}
          </button>
        )}
        {!revoked && onRevoke && (
          <button type="button" onClick={() => onRevoke(link)} style={actionStyle(true)}>
            <LuBan size={12} /> {t('share.row.revoke')}
          </button>
        )}
        {revoked &&
          onDelete &&
          (confirming ? (
            <>
              <button type="button" onClick={() => onDelete(link)} style={actionStyle(true)}>
                {t('share.row.confirmDelete')}
              </button>
              <button type="button" onClick={() => setConfirming(false)} style={actionStyle()}>
                {t('common.cancel')}
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirming(true)} style={actionStyle(true)}>
              <LuTrash2 size={12} /> {t('share.row.delete')}
            </button>
          ))}
      </div>
    </li>
  )
}
