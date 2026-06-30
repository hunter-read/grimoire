import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuTrash2, LuScroll } from 'react-icons/lu'
import SetEmailInline from './SetEmailInline'
import SetPasswordInline from './SetPasswordInline'
import UserCampaignsList from './UserCampaignsList'
import EditorField, { fieldLabelStyle } from './EditorField'
import PermissionToggle from './PermissionToggle'
import { ghostBtnStyle } from './settingsButtons'

export default function UserExpandedEditor({
  user,
  isSelf,
  currentUserRole,
  passwordAuthEnabled,
  onRoleChange,
  onExplicitChange,
  onCampaignAccessChange,
  onPasswordReset,
  onEmailChange,
  onDelete,
}) {
  const { t } = useTranslation()
  const [settingPassword, setSettingPassword] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const isAdmin = currentUserRole === 'admin'
  const showCampaigns = isAdmin && !isSelf

  return (
    <div
      style={{
        padding: '16px 18px 18px',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 18,
        }}
      >
        {/* Email / account */}
        <EditorField label={t('users.emailLabel')}>
          <SetEmailInline
            initial={user.email}
            onSave={(email) => onEmailChange(user.id, email)}
            onCancel={() => {}}
            persistent
          />
        </EditorField>

        {/* Role */}
        <EditorField label={t('users.role')}>
          <select
            id={`role-${user.id}`}
            aria-label={t('users.role')}
            value={user.role}
            onChange={(e) => onRoleChange(user.id, e.target.value)}
            disabled={isSelf}
            title={isSelf ? t('users.cannotChangeSelfRole') : t('users.role')}
            style={{
              background: 'var(--bg-input)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              borderRadius: 6,
              padding: '6px 10px',
              fontSize: 13,
              width: '100%',
              cursor: isSelf ? 'not-allowed' : 'pointer',
              opacity: isSelf ? 0.5 : 1,
            }}
          >
            <option value="player">{t('users.roles.player')}</option>
            <option value="gm">{t('users.roles.gm')}</option>
            <option value="admin">{t('users.roles.admin')}</option>
          </select>
        </EditorField>

        {/* Permissions */}
        <EditorField label={t('users.permissions')}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <PermissionToggle
              id={`campaign-access-${user.id}`}
              label={t('users.campaignAccess')}
              title={t('users.campaignAccessTitle')}
              checked={user.campaign_access ?? true}
              accent="var(--gold)"
              onChange={() => onCampaignAccessChange(user.id, !(user.campaign_access ?? true))}
            />
            <PermissionToggle
              id={`explicit-${user.id}`}
              label={t('users.explicit')}
              title={t('users.allowExplicitTitle')}
              checked={user.allow_explicit ?? true}
              accent="#e07070"
              disabled={isSelf}
              onChange={() => !isSelf && onExplicitChange(user.id, !(user.allow_explicit ?? true))}
            />
          </div>
        </EditorField>

        {/* Password */}
        {passwordAuthEnabled && !isSelf && (
          <EditorField label={t('users.password')}>
            {settingPassword ? (
              <SetPasswordInline
                onSave={(pw) => onPasswordReset(user.id, pw)}
                onCancel={() => setSettingPassword(false)}
              />
            ) : (
              <button
                onClick={() => setSettingPassword(true)}
                style={{ ...ghostBtnStyle, alignSelf: 'flex-start' }}
              >
                {t('users.setPassword')}
              </button>
            )}
          </EditorField>
        )}
      </div>

      {/* Campaigns */}
      {showCampaigns && (
        <div>
          <div style={fieldLabelStyle}>
            <LuScroll size={12} style={{ marginRight: 5, verticalAlign: -1 }} />
            {t('users.campaigns.toggleLabel')}
          </div>
          <UserCampaignsList userId={user.id} />
        </div>
      )}

      {/* Delete */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: 8,
          borderTop: '1px solid var(--border)',
          paddingTop: 14,
        }}
      >
        {confirmDelete ? (
          <>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {t('users.deleteConfirm')}
            </span>
            <button onClick={() => onDelete(user.id)} style={dangerBtnStyle}>
              {t('common.yes')}
            </button>
            <button onClick={() => setConfirmDelete(false)} style={ghostBtnStyle}>
              {t('common.no')}
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            disabled={isSelf}
            title={
              isSelf
                ? t('users.cannotDeleteSelf')
                : t('users.deleteUser', { username: user.username })
            }
            aria-label={t('users.deleteUser', { username: user.username })}
            style={{
              ...dangerBtnStyle,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              opacity: isSelf ? 0.4 : 1,
              cursor: isSelf ? 'not-allowed' : 'pointer',
            }}
          >
            <LuTrash2 size={13} /> {t('users.deleteUserShort')}
          </button>
        )}
      </div>
    </div>
  )
}

const dangerBtnStyle = {
  padding: '6px 12px',
  borderRadius: 6,
  fontSize: 13,
  background: 'rgba(196, 80, 64, 0.15)',
  color: 'var(--red)',
  border: '1px solid var(--red)',
  cursor: 'pointer',
}
