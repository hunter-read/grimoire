import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function SetupView({ onSetup }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({ username: '', password: '', confirm: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (form.password !== form.confirm) {
      setError(t('setup.passwordMismatch'))
      return
    }
    if (form.password.length < 8) {
      setError(t('setup.passwordTooShort'))
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: form.username.trim(), password: form.password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.detail || t('setup.setupFailed'))
        return
      }
      onSetup(data.token, data.user)
    } catch {
      setError(t('setup.serverUnreachable'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-deep)',
        padding: 24,
      }}
    >
      <div style={{ width: '100%', maxWidth: 400 }}>
        {/* Branding */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <h1 style={{ fontSize: 32, letterSpacing: '0.1em', marginBottom: 8 }}>{t('app.name')}</h1>
          <p
            style={{
              color: 'var(--text-muted)',
              fontSize: 13,
              letterSpacing: '0.15em',
              textTransform: 'uppercase',
              fontWeight: 300,
            }}
          >
            {t('app.subtitle')}
          </p>
        </div>

        {/* Card */}
        <div
          style={{
            background: 'var(--bg-panel)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 32,
          }}
        >
          <h2 style={{ fontSize: 18, marginBottom: 8, textAlign: 'center' }}>{t('setup.title')}</h2>
          <p
            style={{
              color: 'var(--text-dim)',
              fontSize: 14,
              textAlign: 'center',
              marginBottom: 28,
              fontFamily: 'Alegreya, serif',
              fontStyle: 'italic',
            }}
          >
            {t('setup.subtitle')}
          </p>

          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label htmlFor="setup-username" style={labelStyle}>
                {t('setup.username')}
              </label>
              <input
                id="setup-username"
                type="text"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                required
                autoFocus
                autoComplete="username"
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <label htmlFor="setup-password" style={labelStyle}>
                {t('setup.password')}
              </label>
              <input
                id="setup-password"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                autoComplete="new-password"
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label htmlFor="setup-confirm" style={labelStyle}>
                {t('setup.confirmPassword')}
              </label>
              <input
                id="setup-confirm"
                type="password"
                value={form.confirm}
                onChange={(e) => setForm({ ...form, confirm: e.target.value })}
                required
                autoComplete="new-password"
                style={{ width: '100%' }}
              />
            </div>

            {error && (
              <div
                style={{ color: 'var(--red)', fontSize: 13, marginBottom: 16, textAlign: 'center' }}
              >
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} style={submitBtnStyle(loading)}>
              {loading ? t('setup.creatingAccount') : t('setup.createAccount')}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

const labelStyle = {
  display: 'block',
  fontSize: 15,
  color: 'var(--text-muted)',
  marginBottom: 6,
  letterSpacing: '0.03em',
}

const submitBtnStyle = (loading) => ({
  width: '100%',
  padding: '12px',
  borderRadius: 8,
  background: loading ? 'var(--gold-dim)' : 'var(--gold-dim)',
  color: 'var(--bg-deep)',
  fontSize: 15,
  fontWeight: 600,
  fontFamily: 'Cinzel, serif',
  letterSpacing: '0.05em',
  opacity: loading ? 0.7 : 1,
  cursor: loading ? 'not-allowed' : 'pointer',
  border: '1px solid var(--gold)',
})
