import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import api from '../../api'
import Spinner from '../Spinner'

export default function DeleteAccountSection({ user, onLogout }) {
  const { t } = useTranslation()
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState(null)
  const isAdmin = user?.role === 'admin'

  const handleDelete = async () => {
    setDeleting(true)
    setError(null)
    try {
      await api.delete('/users/me')
      onLogout()
    } catch (err) {
      setError(err?.message || t('userSettings.deleteAccount.failed'))
      setDeleting(false)
      setConfirming(false)
    }
  }

  return (
    <div>
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6, color: 'var(--danger)' }}>
        {t('userSettings.deleteAccount.title')}
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
        {t('userSettings.deleteAccount.description')}
        {isAdmin && (
          <>
            <br />
            <span style={{ color: 'var(--danger)' }}>
              {t('userSettings.deleteAccount.adminWarning')}
            </span>
          </>
        )}
      </p>

      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          disabled={isAdmin}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 18px',
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 500,
            background: isAdmin ? 'var(--bg-card)' : 'rgba(180,60,60,0.15)',
            border: `1px solid ${isAdmin ? 'var(--border)' : 'rgba(180,60,60,0.5)'}`,
            color: isAdmin ? 'var(--text-muted)' : 'var(--danger)',
            cursor: isAdmin ? 'not-allowed' : 'pointer',
            opacity: isAdmin ? 0.5 : 1,
          }}
        >
          {t('userSettings.deleteAccount.deleteButton')}
        </button>
      ) : (
        <div
          style={{
            padding: '16px 20px',
            borderRadius: 8,
            background: 'rgba(180,60,60,0.08)',
            border: '1px solid rgba(180,60,60,0.4)',
            maxWidth: 420,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>
            {t('userSettings.deleteAccount.confirmMessage')}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={handleDelete}
              disabled={deleting}
              style={{
                padding: '7px 16px',
                borderRadius: 6,
                fontSize: 14,
                fontWeight: 500,
                background: 'var(--danger-fill)',
                border: 'none',
                color: 'var(--on-danger)',
                cursor: deleting ? 'default' : 'pointer',
                opacity: deleting ? 0.6 : 1,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {deleting && <Spinner size={13} />}
              {deleting
                ? t('userSettings.deleteAccount.deleting')
                : t('userSettings.deleteAccount.confirmDelete')}
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={deleting}
              style={{
                padding: '7px 16px',
                borderRadius: 6,
                fontSize: 14,
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                color: 'var(--text-dim)',
                cursor: 'pointer',
              }}
            >
              {t('common.cancel')}
            </button>
          </div>
          {error && (
            <div style={{ fontSize: 13, color: 'var(--danger)', marginTop: 10 }}>{error}</div>
          )}
        </div>
      )}
    </div>
  )
}
