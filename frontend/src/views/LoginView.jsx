import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { sanitizeLoginMessage } from '../utils/sanitizeLoginMessage'

export default function LoginView({ onLogin }) {
  const { t } = useTranslation()
  const [form, setForm] = useState({ username: '', password: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [config, setConfig] = useState({
    password_auth_enabled: true,
    custom_login_message_enabled: false,
    custom_login_message: '',
    oidc_enabled: false,
    oidc_button_text: '',
    oidc_auto_launch: false,
  })
  const [oidcError, setOidcError] = useState('')

  // ?autoLaunch=0 (or other falsy strings) suppresses the auto-redirect.
  // Logout sets a sessionStorage flag so we don't bounce the user straight back.
  const queryParams = new URLSearchParams(window.location.search)
  const autoLaunchParam = queryParams.get('autoLaunch')
  const suppressAutoLaunch =
    autoLaunchParam === '0' ||
    autoLaunchParam === 'false' ||
    autoLaunchParam === 'no' ||
    sessionStorage.getItem('grimoire:suppress_oidc_autolaunch') === '1'

  useEffect(() => {
    // If the OIDC callback redirected here with an error, surface it.
    const err = queryParams.get('oidc_error')
    if (err) setOidcError(err)

    // If the callback redirected here with a token in the URL fragment,
    // pick it up and complete the login.
    const hash = window.location.hash
    if (hash.startsWith('#oidc_token=')) {
      const token = hash.slice('#oidc_token='.length)
      // Clear the fragment from the URL bar
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
      fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => (r.ok ? r.json() : null))
        .then((user) => {
          if (user) onLogin(token, user)
          else setOidcError(t('login.oidcLoginFailed'))
        })
        .catch(() => setOidcError(t('login.oidcLoginFailed')))
      return
    }

    fetch('/api/auth/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data || typeof data.password_auth_enabled !== 'boolean') return
        const next = {
          password_auth_enabled: data.password_auth_enabled,
          custom_login_message_enabled: !!data.custom_login_message_enabled,
          custom_login_message: data.custom_login_message || '',
          oidc_enabled: !!data.oidc_enabled,
          oidc_button_text: data.oidc_button_text || '',
          oidc_auto_launch: !!data.oidc_auto_launch,
        }
        setConfig(next)
        if (next.oidc_enabled && next.oidc_auto_launch && !suppressAutoLaunch && !err) {
          window.location.assign('/api/auth/openid/login')
        }
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleOidcLogin = () => {
    sessionStorage.removeItem('grimoire:suppress_oidc_autolaunch')
    window.location.assign('/api/auth/openid/login')
  }

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

        {/* Custom login message */}
        {config.custom_login_message_enabled && config.custom_login_message && (
          <div
            style={{
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: '16px 20px',
              marginBottom: 20,
              fontSize: 14,
              color: 'var(--text)',
              lineHeight: 1.5,
            }}
            dangerouslySetInnerHTML={{
              __html: sanitizeLoginMessage(config.custom_login_message),
            }}
          />
        )}

        {/* Card */}
        <div
          style={{
            background: 'var(--bg-panel)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 32,
          }}
        >
          {oidcError && (
            <div
              style={{
                background: 'rgba(180,60,60,0.12)',
                border: '1px solid rgba(180,60,60,0.4)',
                borderRadius: 8,
                padding: '10px 14px',
                fontSize: 13,
                color: '#e07070',
                marginBottom: 16,
                textAlign: 'center',
              }}
            >
              {t('login.oidcError', { error: oidcError })}
            </div>
          )}

          {!config.password_auth_enabled && !config.oidc_enabled ? (
            <div
              style={{
                textAlign: 'center',
                color: 'var(--text-dim)',
                fontSize: 14,
                lineHeight: 1.6,
              }}
            >
              {t('login.passwordAuthDisabled')}
            </div>
          ) : (
            <>
              {config.password_auth_enabled && (
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
                      style={{
                        color: 'var(--red)',
                        fontSize: 13,
                        marginBottom: 16,
                        textAlign: 'center',
                      }}
                    >
                      {error}
                    </div>
                  )}

                  <button type="submit" disabled={loading} style={submitBtnStyle(loading)}>
                    {loading ? t('login.entering') : t('login.enter')}
                  </button>
                </form>
              )}
              {config.password_auth_enabled && config.oidc_enabled && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    margin: '20px 0',
                    color: 'var(--text-muted)',
                    fontSize: 12,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                  }}
                >
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  <span>{t('login.or')}</span>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                </div>
              )}
              {config.oidc_enabled && (
                <button
                  type="button"
                  onClick={handleOidcLogin}
                  style={oidcBtnStyle}
                  aria-label={config.oidc_button_text || t('login.oidcDefault')}
                >
                  {config.oidc_button_text || t('login.oidcDefault')}
                </button>
              )}
            </>
          )}
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

const oidcBtnStyle = {
  width: '100%',
  padding: '12px',
  borderRadius: 8,
  background: 'var(--bg-card)',
  color: 'var(--text)',
  fontSize: 15,
  fontWeight: 500,
  letterSpacing: '0.04em',
  cursor: 'pointer',
  border: '1px solid var(--border)',
}
