import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import api from '../../api'
import Spinner from '../Spinner'
import type { SettingsUser } from './areas/types'

interface Props {
  user?: SettingsUser | null
  onLogout?: () => void
}

export default function DeleteAccountSection({ user, onLogout }: Props) {
  const { t } = useTranslation()
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isAdmin = user?.role === 'admin'
  const deleteRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmId = useId()
  const opened = useRef(false)

  // The button pressed is replaced by the confirmation, which would leave
  // focus nowhere: it moves to Cancel (the safe choice), and back to the
  // button when the confirmation goes away.
  useEffect(() => {
    if (confirming) {
      opened.current = true
      cancelRef.current?.focus()
    } else if (opened.current) {
      opened.current = false
      deleteRef.current?.focus()
    }
  }, [confirming])

  const handleDelete = async () => {
    setDeleting(true)
    setError(null)
    try {
      await api.delete('/users/me')
      onLogout!()
    } catch (err) {
      setError((err as Error | null)?.message || t('userSettings.deleteAccount.failed'))
      setDeleting(false)
      setConfirming(false)
    }
  }

  return (
    <div>
      <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, color: 'var(--danger)' }}>
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
          ref={deleteRef}
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
          role="group"
          aria-labelledby={confirmId}
          style={{
            padding: '16px 20px',
            borderRadius: 8,
            background: 'rgba(180,60,60,0.08)',
            border: '1px solid rgba(180,60,60,0.4)',
            maxWidth: 420,
          }}
        >
          <div id={confirmId} style={{ fontSize: 14, fontWeight: 500, marginBottom: 12 }}>
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
              ref={cancelRef}
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
        </div>
      )}
      {/* Outside the confirmation: a failed delete closes it, and the reason
          used to vanish with it. */}
      {error && (
        <div role="alert" style={{ fontSize: 13, color: 'var(--danger)', marginTop: 10 }}>
          {error}
        </div>
      )}
    </div>
  )
}
