import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export default function LoginView({ onLogin }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({ username: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: form.username.trim(), password: form.password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.detail || t('login.loginFailed'))
        return
      }
      onLogin(data.token, data.user)
    } catch {
      setError(t('login.serverUnreachable'))
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
        paddingBottom: '20vh',
      }}
    >
      <div style={{ width: '100%', maxWidth: 360 }}>
        {/* Branding */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <img
            src="/android-chrome-192x192.png"
            alt="Grimoire"
            style={{ width: 148, height: 148 }}
          />
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
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom: 16 }}>
              <label htmlFor="login-username" style={labelStyle}>
                {t('login.username')}
              </label>
              <input
                id="login-username"
                type="text"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                required
                autoFocus
                autoComplete="username"
                style={{ width: '100%' }}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label htmlFor="login-password" style={labelStyle}>
                {t('login.password')}
              </label>
              <input
                id="login-password"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                autoComplete="current-password"
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
              {loading ? t('login.entering') : t('login.enter')}
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
  background: 'var(--gold-dim)',
  color: 'var(--bg-deep)',
  fontSize: 15,
  fontWeight: 600,
  fontFamily: 'Cinzel, serif',
  letterSpacing: '0.05em',
  opacity: loading ? 0.7 : 1,
  cursor: loading ? 'not-allowed' : 'pointer',
  border: '1px solid var(--gold)',
})
