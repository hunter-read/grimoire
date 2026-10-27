import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LuArrowLeft, LuRotateCw } from 'react-icons/lu'

const buttonStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 16px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg-card)',
  color: 'var(--text)',
  cursor: 'pointer',
}

/** What ErrorBoundary shows in place of a view that failed to render. */
export default function ErrorFallback() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  // React Router numbers its history entries. On the first one - a link opened
  // in a new tab - there is nothing in the app to go back to, so go home.
  const canGoBack = ((window.history.state as { idx?: number } | null)?.idx ?? 0) > 0

  return (
    <div role="alert" style={{ padding: '64px 16px', textAlign: 'center' }}>
      <h2 style={{ marginBottom: 8 }}>{t('common.error')}</h2>
      <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>{t('errorBoundary.message')}</p>
      <div style={{ display: 'inline-flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            ...buttonStyle,
            border: 'none',
            background: 'var(--gold)',
            color: 'var(--bg-deep)',
            fontWeight: 500,
          }}
        >
          <LuRotateCw size={16} aria-hidden="true" /> {t('errorBoundary.reload')}
        </button>
        <button
          type="button"
          onClick={() => (canGoBack ? navigate(-1) : navigate('/'))}
          style={buttonStyle}
        >
          <LuArrowLeft size={16} aria-hidden="true" /> {t('common.back')}
        </button>
      </div>
    </div>
  )
}
