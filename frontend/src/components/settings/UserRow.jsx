import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuChevronRight, LuScroll } from 'react-icons/lu'
import RoleBadge from './RoleBadge'
import UserPermissionBadges from './UserPermissionBadges'
import UserExpandedEditor from './UserExpandedEditor'

export default function UserRow({
  user,
  currentUserId,
  currentUserRole,
  passwordAuthEnabled,
  expanded,
  onToggleExpand,
  onRoleChange,
  onExplicitChange,
  onCampaignAccessChange,
  onPasswordReset,
  onEmailChange,
  onDelete,
  columnCount,
}) {
  const { t } = useTranslation()
  const isSelf = user.id === currentUserId
  const count = user.campaign_count ?? 0

  return (
    <>
      <tr
        onClick={onToggleExpand}
        style={{
          cursor: 'pointer',
          background: expanded ? 'var(--bg-deep)' : 'transparent',
          borderTop: '1px solid var(--border)',
        }}
      >
        <td style={{ ...cellStyle, width: 28, paddingRight: 0 }}>
          <LuChevronRight
            size={14}
            style={{
              color: 'var(--text-muted)',
              transition: 'transform 0.15s ease',
              transform: expanded ? 'rotate(90deg)' : 'none',
            }}
          />
        </td>

        <td style={cellStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span
              style={{
                fontSize: 14,
                fontWeight: 500,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {user.username}
            </span>
            {isSelf && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)', flexShrink: 0 }}>
                {t('users.you')}
              </span>
            )}
            {user.oidc_linked && (
              <span style={oidcBadgeStyle} title={t('users.oidcLinkedTitle')}>
                OIDC
              </span>
            )}
          </div>
          {user.email && (
            <div
              style={{
                fontSize: 12,
                color: 'var(--text-dim)',
                marginTop: 2,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {user.email}
            </div>
          )}
        </td>

        <td style={{ ...cellStyle, whiteSpace: 'nowrap' }}>
          <RoleBadge role={user.role} />
        </td>

        <td style={cellStyle}>
          <UserPermissionBadges
            allowExplicit={user.allow_explicit ?? true}
            campaignAccess={user.campaign_access ?? true}
          />
        </td>

        <td style={{ ...cellStyle, textAlign: 'right', whiteSpace: 'nowrap' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 13,
              color: count > 0 ? 'var(--text)' : 'var(--text-muted)',
            }}
            title={t('users.ownedCampaigns')}
          >
            <LuScroll
              size={13}
              style={{ color: count > 0 ? 'var(--gold)' : 'var(--text-muted)' }}
            />
            {count}
          </span>
        </td>
      </tr>

      {expanded && (
        <tr style={{ background: 'var(--bg-deep)' }}>
          <td colSpan={columnCount} style={{ padding: 0 }}>
            <UserExpandedEditor
              user={user}
              isSelf={isSelf}
              currentUserRole={currentUserRole}
              passwordAuthEnabled={passwordAuthEnabled}
              onRoleChange={onRoleChange}
              onExplicitChange={onExplicitChange}
              onCampaignAccessChange={onCampaignAccessChange}
              onPasswordReset={onPasswordReset}
              onEmailChange={onEmailChange}
              onDelete={onDelete}
            />
          </td>
        </tr>
      )}
    </>
  )
}

const cellStyle = {
  padding: '12px 14px',
  verticalAlign: 'middle',
}

const oidcBadgeStyle = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.06em',
  padding: '1px 6px',
  borderRadius: 4,
  background: 'rgba(120, 160, 200, 0.15)',
  color: 'var(--text-dim)',
  border: '1px solid rgba(120, 160, 200, 0.4)',
  flexShrink: 0,
}
