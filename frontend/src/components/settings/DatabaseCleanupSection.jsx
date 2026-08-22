import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LuTrash2, LuCircleCheck } from 'react-icons/lu'
import api from '../../api'
import Spinner from '../Spinner'

export default function DatabaseCleanupSection() {
  const { t } = useTranslation()
  const [cleaning, setCleaning] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const handleCleanup = async () => {
    setCleaning(true)
    setResult(null)
    setError(null)
    try {
      const data = await api.post('/maintenance/cleanup-missing')
      setResult(data.removed)
    } catch {
      setError(t('maintenance.cleanup.failed'))
    } finally {
      setCleaning(false)
    }
  }

  const total = result ? result.books + result.maps + result.tokens : 0

  return (
    // Matches the other maintenance sections: each owns the space above the
    // divider that follows it.
    <div style={{ marginBottom: 40 }}>
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
        {t('maintenance.cleanup.title')}
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
        {t('maintenance.cleanup.description')}
      </p>

      <button
        onClick={handleCleanup}
        disabled={cleaning}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '9px 18px',
          borderRadius: 6,
          fontSize: 14,
          fontWeight: 500,
          background: cleaning ? 'rgba(180,60,60,0.5)' : 'rgba(180,60,60,0.15)',
          border: '1px solid rgba(180,60,60,0.5)',
          color: cleaning ? 'var(--text-muted)' : 'var(--danger)',
          cursor: cleaning ? 'default' : 'pointer',
          transition: 'background 0.15s',
        }}
        onMouseEnter={(e) => {
          if (!cleaning) e.currentTarget.style.background = 'rgba(180,60,60,0.25)'
        }}
        onMouseLeave={(e) => {
          if (!cleaning) e.currentTarget.style.background = 'rgba(180,60,60,0.15)'
        }}
      >
        {cleaning ? <Spinner size={14} /> : <LuTrash2 size={14} />}
        {cleaning ? t('maintenance.cleanup.cleaning') : t('maintenance.cleanup.button')}
      </button>

      {result !== null && (
        <div
          style={{
            marginTop: 20,
            padding: '14px 18px',
            borderRadius: 8,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
          }}
        >
          <LuCircleCheck size={18} color="var(--green)" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>
              {total === 0
                ? t('maintenance.cleanup.nothingToRemove')
                : t('maintenance.cleanup.removed', { count: total })}
            </div>
            {total > 0 && (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', gap: 16 }}>
                {result.books > 0 && (
                  <span>{t('maintenance.cleanup.books', { count: result.books })}</span>
                )}
                {result.maps > 0 && (
                  <span>{t('maintenance.cleanup.maps', { count: result.maps })}</span>
                )}
                {result.tokens > 0 && (
                  <span>{t('maintenance.cleanup.tokens', { count: result.tokens })}</span>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {error && <div style={{ marginTop: 16, fontSize: 14, color: 'var(--danger)' }}>{error}</div>}
    </div>
  )
}
