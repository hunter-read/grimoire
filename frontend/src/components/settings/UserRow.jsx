import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuX, LuKeyRound, LuMail } from 'react-icons/lu'
import RoleBadge from './RoleBadge'

const isMobile = window.matchMedia('(max-width: 640px)').matches

function SetEmailInline({ initial, onSave, onCancel }) {
  const { t } = useTranslation()
  const [value, setValue] = useState(initial || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const handleSave = async () => {
    setSaving(true)
    setErr('')
    try {
      await onSave(value.trim())
      onCancel()
    } catch (e) {
      setErr(e?.message || t('users.failedSetEmail'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <input
        type="email"
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          setErr('')
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave()
          if (e.key === 'Escape') onCancel()
        }}
        placeholder={t('users.emailPlaceholder')}
        autoFocus
        style={{
          background: 'var(--bg-input)',
          border: '1px solid var(--border)',
          color: 'var(--text)',
          borderRadius: 6,
          padding: '4px 8px',
          fontSize: 13,
          width: 240,
        }}
      />
      {err && <span style={{ fontSize: 12, color: 'var(--red)' }}>{err}</span>}
      <button onClick={handleSave} disabled={saving} style={saveBtnStyle}>
        {saving ? '…' : t('common.save')}
      </button>
      <button onClick={onCancel} style={ghostBtnStyle}>
        {t('common.cancel')}
      </button>
    </div>
  )
}

function SetPasswordInline({ onSave, onCancel }) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const handleSave = async () => {
    if (value.length < 8) {
      setErr(t('users.minChars'))
      return
    }
    setSaving(true)
    try {
      await onSave(value)
      onCancel()
    } catch {
      setErr(t('users.failedSetPassword'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <input
        type="password"
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          setErr('')
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') handleSave()
          if (e.key === 'Escape') onCancel()
        }}
        placeholder={t('users.newPasswordPlaceholder')}
        autoFocus
        style={{
          background: 'var(--bg-input)',
          border: '1px solid var(--border)',
          color: 'var(--text)',
          borderRadius: 6,
          padding: '4px 8px',
          fontSize: 13,
          width: 180,
        }}
      />
      {err && <span style={{ fontSize: 12, color: 'var(--red)' }}>{err}</span>}
      <button onClick={handleSave} disabled={saving} style={saveBtnStyle}>
        {saving ? '…' : t('users.setPassword')}
      </button>
      <button onClick={onCancel} style={ghostBtnStyle}>
        {t('common.cancel')}
      </button>
    </div>
  )
}

export default function UserRow({
  user,
  currentUserId,
  onRoleChange,
  onExplicitChange,
  onPasswordReset,
  onEmailChange,
  onDelete,
}) {
  const { t } = useTranslation()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [settingPassword, setSettingPassword] = useState(false)
  const [settingEmail, setSettingEmail] = useState(false)
  const isSelf = user.id === currentUserId
  const canSetPassword = !isSelf

  const emailDisplay = user.email || (
    <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{t('users.noEmail')}</span>
  )

  if (isMobile) {
    return (
      <div
        style={{
          padding: '12px 14px',
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 8,
        }}
      >
        {/* Top row: username + delete */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 10,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <span
                style={{
                  fontSize: 15,
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
            <div
              style={{
                fontSize: 12,
                color: 'var(--text-dim)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                marginTop: 2,
              }}
            >
              {emailDisplay}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <RoleBadge role={user.role} />
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
                  ...ghostBtnStyle,
                  padding: '5px 8px',
                  opacity: isSelf ? 0.3 : 1,
                  cursor: isSelf ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <LuX size={13} />
              </button>
            )}
          </div>
        </div>

        {/* Bottom row: role select + explicit */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <select
            value={user.role}
            onChange={(e) => onRoleChange(user.id, e.target.value)}
            disabled={isSelf}
            title={isSelf ? t('users.cannotChangeSelfRole') : t('users.role')}
            style={{
              background: 'var(--bg-input)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
              borderRadius: 6,
              padding: '4px 8px',
              fontSize: 13,
              cursor: isSelf ? 'not-allowed' : 'pointer',
              opacity: isSelf ? 0.4 : 1,
            }}
          >
            <option value="player">{t('users.roles.player')}</option>
            <option value="gm">{t('users.roles.gm')}</option>
            <option value="admin">{t('users.roles.admin')}</option>
          </select>

          <label
            title={t('users.allowExplicitTitle')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              cursor: isSelf ? 'default' : 'pointer',
              opacity: isSelf ? 0.4 : 1,
            }}
          >
            <input
              type="checkbox"
              checked={user.allow_explicit ?? true}
              onChange={() => !isSelf && onExplicitChange(user.id, !(user.allow_explicit ?? true))}
              disabled={isSelf}
              style={{
                width: 14,
                height: 14,
                cursor: isSelf ? 'not-allowed' : 'pointer',
                accentColor: '#e07070',
              }}
            />
            <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
              {t('users.explicit')}
            </span>
          </label>

          {canSetPassword && !settingPassword && (
            <button
              onClick={() => setSettingPassword(true)}
              title={t('users.setPasswordTitle')}
              style={{
                ...ghostBtnStyle,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 8px',
                fontSize: 12,
              }}
            >
              <LuKeyRound size={12} /> {t('users.setPassword')}
            </button>
          )}

          {!settingEmail && (
            <button
              onClick={() => setSettingEmail(true)}
              title={t('users.editEmail')}
              style={{
                ...ghostBtnStyle,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '4px 8px',
                fontSize: 12,
              }}
            >
              <LuMail size={12} /> {t('users.editEmail')}
            </button>
          )}
        </div>

        {settingPassword && (
          <div style={{ marginTop: 8 }}>
            <SetPasswordInline
              onSave={(pw) => onPasswordReset(user.id, pw)}
              onCancel={() => setSettingPassword(false)}
            />
          </div>
        )}

        {settingEmail && (
          <div style={{ marginTop: 8 }}>
            <SetEmailInline
              initial={user.email}
              onSave={(email) => onEmailChange(user.id, email)}
              onCancel={() => setSettingEmail(false)}
            />
          </div>
        )}
      </div>
    )
  }

  return (
    <div
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 500 }}>{user.username}</span>
            {isSelf && (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('users.you')}</span>
            )}
            {user.oidc_linked && (
              <span style={oidcBadgeStyle} title={t('users.oidcLinkedTitle')}>
                OIDC
              </span>
            )}
          </div>
          <div
            style={{
              fontSize: 12,
              color: 'var(--text-dim)',
              marginTop: 2,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              overflow: 'hidden',
            }}
          >
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
            >
              {emailDisplay}
            </span>
            <button
              onClick={() => setSettingEmail((v) => !v)}
              title={t('users.editEmail')}
              aria-label={t('users.editEmail')}
              style={{
                ...ghostBtnStyle,
                padding: '2px 6px',
                fontSize: 11,
                display: 'inline-flex',
                alignItems: 'center',
                color: settingEmail ? 'var(--gold)' : 'var(--text-muted)',
              }}
            >
              <LuMail size={11} />
            </button>
          </div>
        </div>

        <RoleBadge role={user.role} />

        <label
          title={t('users.allowExplicitTitle')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            cursor: isSelf ? 'default' : 'pointer',
            opacity: isSelf ? 0.4 : 1,
          }}
        >
          <input
            type="checkbox"
            checked={user.allow_explicit ?? true}
            onChange={() => !isSelf && onExplicitChange(user.id, !(user.allow_explicit ?? true))}
            disabled={isSelf}
            style={{
              width: 14,
              height: 14,
              cursor: isSelf ? 'not-allowed' : 'pointer',
              accentColor: '#e07070',
            }}
          />
          <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {t('users.explicit')}
          </span>
        </label>

        <select
          value={user.role}
          onChange={(e) => onRoleChange(user.id, e.target.value)}
          disabled={isSelf}
          title={isSelf ? t('users.cannotChangeSelfRole') : t('users.role')}
          style={{
            background: 'var(--bg-input)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            borderRadius: 6,
            padding: '4px 8px',
            fontSize: 13,
            cursor: isSelf ? 'not-allowed' : 'pointer',
            opacity: isSelf ? 0.4 : 1,
          }}
        >
          <option value="player">{t('users.roles.player')}</option>
          <option value="gm">{t('users.roles.gm')}</option>
          <option value="admin">{t('users.roles.admin')}</option>
        </select>

        {canSetPassword && (
          <button
            onClick={() => setSettingPassword((v) => !v)}
            title={t('users.setPasswordTitle')}
            aria-label={t('users.setPasswordTitle')}
            style={{
              ...ghostBtnStyle,
              padding: '5px 8px',
              display: 'flex',
              alignItems: 'center',
              color: settingPassword ? 'var(--gold)' : 'var(--text-dim)',
              outline: settingPassword ? '1px solid var(--gold-dim)' : 'none',
            }}
          >
            <LuKeyRound size={13} />
          </button>
        )}

        {confirmDelete ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {t('users.deleteConfirm')}
            </span>
            <button onClick={() => onDelete(user.id)} style={dangerBtnStyle}>
              {t('common.yes')}
            </button>
            <button onClick={() => setConfirmDelete(false)} style={ghostBtnStyle}>
              {t('common.no')}
            </button>
          </div>
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
              ...ghostBtnStyle,
              padding: '5px 8px',
              opacity: isSelf ? 0.3 : 1,
              cursor: isSelf ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <LuX size={13} />
          </button>
        )}
      </div>

      {settingPassword && (
        <div
          style={{
            padding: '10px 16px',
            borderTop: '1px solid var(--border)',
            background: 'var(--bg-deep)',
          }}
        >
          <SetPasswordInline
            onSave={(pw) => onPasswordReset(user.id, pw)}
            onCancel={() => setSettingPassword(false)}
          />
        </div>
      )}

      {settingEmail && (
        <div
          style={{
            padding: '10px 16px',
            borderTop: '1px solid var(--border)',
            background: 'var(--bg-deep)',
          }}
        >
          <SetEmailInline
            initial={user.email}
            onSave={(email) => onEmailChange(user.id, email)}
            onCancel={() => setSettingEmail(false)}
          />
        </div>
      )}
    </div>
  )
}

const ghostBtnStyle = {
  padding: '6px 12px',
  borderRadius: 6,
  fontSize: 13,
  background: 'var(--bg-card)',
  color: 'var(--text-dim)',
  border: '1px solid var(--border)',
  cursor: 'pointer',
}

const saveBtnStyle = {
  padding: '4px 12px',
  borderRadius: 6,
  fontSize: 13,
  background: 'var(--gold-dim)',
  color: 'var(--bg-deep)',
  border: '1px solid var(--gold-dim)',
  cursor: 'pointer',
}

const dangerBtnStyle = {
  padding: '4px 10px',
  borderRadius: 6,
  fontSize: 12,
  background: 'rgba(196, 80, 64, 0.15)',
  color: 'var(--red)',
  border: '1px solid var(--red)',
  cursor: 'pointer',
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
}
