import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuUserCheck, LuX } from 'react-icons/lu'
import api from '../../api'

// A single guest row with an inline convert-to-permanent form. Password is only
// asked for when password auth is enabled on the server.
export default function GuestRow({
  guest,
  passwordAuthEnabled,
  converting,
  onStartConvert,
  onCancelConvert,
  onConverted,
  onError,
}) {
  const { t } = useTranslation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('player')
  const [saving, setSaving] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    onError('')
    setSaving(true)
    try {
      const body = { username: username.trim(), role }
      if (passwordAuthEnabled) body.password = password
      const updated = await api.post(`/users/${guest.id}/convert`, body)
      onConverted(updated)
    } catch (err) {
      onError(err?.body?.detail || err.message || t('guests.convertFailed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <tr style={{ borderTop: '1px solid var(--border)' }}>
        <td style={cellStyle}>{guest.display_name || '—'}</td>
        <td style={cellStyle}>{guest.campaign_name || <span style={dimStyle}>—</span>}</td>
        <td style={cellStyle}>{guest.invited_by || <span style={dimStyle}>—</span>}</td>
        <td style={{ ...cellStyle, textAlign: 'right' }}>
          {converting ? (
            <button onClick={onCancelConvert} style={iconBtnStyle} aria-label={t('common.cancel')}>
              <LuX size={14} />
            </button>
          ) : (
            <button
              onClick={onStartConvert}
              style={{ ...iconBtnStyle, display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <LuUserCheck size={14} /> {t('guests.convert')}
            </button>
          )}
        </td>
      </tr>
      {converting && (
        <tr style={{ background: 'var(--bg-deep)' }}>
          <td colSpan={4} style={{ padding: '12px 14px' }}>
            <form
              onSubmit={submit}
              style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}
            >
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t('guests.usernamePlaceholder')}
                required
                style={inputStyle}
              />
              {passwordAuthEnabled && (
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('users.newPasswordPlaceholder')}
                  required
                  minLength={8}
                  style={inputStyle}
                />
              )}
              <select value={role} onChange={(e) => setRole(e.target.value)} style={inputStyle}>
                <option value="player">{t('users.roles.player')}</option>
                <option value="gm">{t('users.roles.gm')}</option>
                <option value="admin">{t('users.roles.admin')}</option>
              </select>
              <button type="submit" disabled={saving} style={saveBtnStyle}>
                {saving ? t('guests.converting') : t('guests.convert')}
              </button>
            </form>
          </td>
        </tr>
      )}
    </>
  )
}

const cellStyle = { padding: '10px 14px', fontSize: 13, color: 'var(--text)' }
const dimStyle = { color: 'var(--text-dim)' }

const iconBtnStyle = {
  background: 'none',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '5px 10px',
  fontSize: 12,
  color: 'var(--text-dim)',
  cursor: 'pointer',
}

const inputStyle = {
  padding: '6px 10px',
  borderRadius: 6,
  fontSize: 13,
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
}

const saveBtnStyle = {
  padding: '6px 14px',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 500,
  background: 'var(--gold-dim)',
  color: 'var(--bg-deep)',
  border: '1px solid var(--gold-dim)',
  cursor: 'pointer',
}
