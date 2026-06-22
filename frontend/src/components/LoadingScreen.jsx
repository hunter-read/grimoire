import { useTranslation } from 'react-i18next'
import Spinner from './Spinner'

/** Full-screen branded loading state shown while auth status resolves. */
export default function LoadingScreen() {
  const { t } = useTranslation()
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg-deep)',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 28, letterSpacing: '0.1em', marginBottom: 24 }}>{t('app.name')}</h1>
        <Spinner size={28} />
      </div>
    </div>
  )
}
