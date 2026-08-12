import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCheck, LuX } from 'react-icons/lu'
import api from '../../api'

export default function AddUserForm({ onAdd, onCancel, passwordAuthEnabled = true }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({
    username: '',
    email: '',
    password: '',
    role: 'player',
    allow_explicit: true,
    campaign_access: true,
  })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (passwordAuthEnabled && form.password.length < 8) {
      setError(t('users.passwordTooShort'))
      return
    }
    setLoading(true)
    try {
      const payload = {
        username: form.username,
        role: form.role,
        allow_explicit: form.allow_explicit,
        campaign_access: form.campaign_access,
        ...(passwordAuthEnabled && form.password ? { password: form.password } : {}),
        ...(form.email.trim() ? { email: form.email.trim() } : {}),
      }
      const user = await api.post('/users', payload)
      onAdd(user)
    } catch (err) {
      setError(err.message || t('users.failedCreateUser'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      autoComplete="off"
      style={{
        background: 'var(--bg-input)',
        border: '1px solid var(--border-light)',
        borderRadius: 8,
        padding: 20,
        marginTop: 12,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: passwordAuthEnabled ? '1fr 1fr auto' : '1fr auto',
            gap: 12,
            alignItems: 'end',
          }}
        >
          <div>
            <label htmlFor="add-user-username" style={labelStyle}>
              {t('users.username')}
            </label>
            <input
              id="add-user-username"
              type="text"
              required
              autoFocus
              autoComplete="off"
              value={form.username}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              style={{ width: '100%' }}
            />
          </div>
          {passwordAuthEnabled && (
            <div>
              <label htmlFor="add-user-password" style={labelStyle}>
                {t('users.password')}
              </label>
              <input
                id="add-user-password"
                type="password"
                required
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                style={{ width: '100%' }}
              />
            </div>
          )}
          <div>
            <label htmlFor="add-user-role" style={labelStyle}>
              {t('users.role')}
            </label>
            <select
              id="add-user-role"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}
              style={{
                background: 'var(--bg-input)',
                border: '1px solid var(--border)',
                color: 'var(--text)',
                borderRadius: 6,
                padding: '8px 10px',
                fontSize: 15,
              }}
            >
              <option value="player">{t('users.roles.player')}</option>
              <option value="gm">{t('users.roles.gm')}</option>
              <option value="admin">{t('users.roles.admin')}</option>
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="add-user-email" style={labelStyle}>
            {t('users.emailOptional')}
          </label>
          <input
            id="add-user-email"
            type="email"
            autoComplete="off"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            style={{ width: '100%' }}
          />
        </div>

        <div>
          <span style={labelStyle}>{t('users.permissions')}</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, marginTop: 2 }}>
            <label
              htmlFor="add-user-campaign-access"
              title={t('users.campaignAccessTitle')}
              style={permLabelStyle}
            >
              <input
                id="add-user-campaign-access"
                type="checkbox"
                checked={form.campaign_access}
                onChange={(e) => setForm({ ...form, campaign_access: e.target.checked })}
                style={{ width: 14, height: 14, accentColor: 'var(--gold)' }}
              />
              {t('users.campaignAccess')}
            </label>
            <label
              htmlFor="add-user-allow-explicit"
              title={t('users.allowExplicitTitle')}
              style={permLabelStyle}
            >
              <input
                id="add-user-allow-explicit"
                type="checkbox"
                checked={form.allow_explicit}
                onChange={(e) => setForm({ ...form, allow_explicit: e.target.checked })}
                style={{ width: 14, height: 14, accentColor: 'var(--danger)' }}
              />
              {t('users.explicit')}
            </label>
          </div>
        </div>
      </div>

      {error && <div style={{ color: 'var(--red)', fontSize: 13, marginTop: 10 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button
          type="submit"
          disabled={loading}
          style={{ ...primaryBtnStyle, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <LuCheck size={13} />
          {loading ? t('users.creating') : t('users.createUser')}
        </button>
        <button
          type="button"
          onClick={onCancel}
          style={{ ...ghostBtnStyle, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <LuX size={13} /> {t('common.cancel')}
        </button>
      </div>
    </form>
  )
}

const labelStyle = { display: 'block', fontSize: 14, color: 'var(--text-muted)', marginBottom: 4 }

const permLabelStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 13,
  color: 'var(--text)',
  cursor: 'pointer',
}

const primaryBtnStyle = {
  padding: '8px 16px',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 500,
  background: 'var(--gold-dim)',
  color: 'var(--bg-deep)',
  border: '1px solid var(--gold-dim)',
  cursor: 'pointer',
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
