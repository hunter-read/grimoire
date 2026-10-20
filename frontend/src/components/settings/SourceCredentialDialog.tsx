import { useEffect, useId, useState, type CSSProperties, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { addons, type Schema } from '../../api'

type CredentialInfo = Schema<'SourceCredentialInfo'>
type CredentialMap = Schema<'SourceCredentialsResponse'>['source_credentials']

interface Props {
  url: string
  name: string
  info?: CredentialInfo
  onClose: () => void
  onSaved: (credentials: CredentialMap) => void
}

// A failed request's message: the server's `detail` when it sent one.
const failure = (err: unknown): string => {
  const e = err as { body?: { detail?: unknown }; message?: string } | null | undefined
  const detail = e?.body?.detail
  return (typeof detail === 'string' && detail) || e?.message || ''
}

const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg-deep)',
  color: 'var(--text)',
  fontSize: 13,
}

const buttonStyle: CSSProperties = {
  padding: '8px 16px',
  borderRadius: 6,
  background: 'none',
  border: '1px solid var(--border)',
  color: 'var(--text)',
  cursor: 'pointer',
  fontSize: 13,
}

/**
 * Sets or removes the access token for one private add-on source (issue #642).
 *
 * The token is write-only: the server never returns it, so an existing one is
 * shown as "saved" and can only be replaced or removed. One pinned through
 * ADDON_INDEX_CREDENTIALS is read-only here.
 */
export default function SourceCredentialDialog({ url, name, info, onClose, onSaved }: Props) {
  const { t } = useTranslation()
  const [header, setHeader] = useState(info?.header || 'Authorization')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const locked = Boolean(info?.env_locked)
  const hintId = useId()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const submit = (request: Promise<Schema<'SourceCredentialsResponse'>>) => {
    setBusy(true)
    setError('')
    request
      .then((body) => onSaved(body.source_credentials || {}))
      .catch((err: unknown) => setError(failure(err) || t('addons.tokenSaveFailed')))
      .finally(() => setBusy(false))
  }

  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!token.trim()) return
    submit(addons.setSourceCredential({ url, token: token.trim(), header: header.trim() || null }))
  }

  const remove = () => submit(addons.clearSourceCredential(url))

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('addons.tokenTitle', { name })}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--scrim)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <form
        onSubmit={save}
        style={{
          background: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: 24,
          width: 440,
          maxWidth: '92vw',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 16 }}>{t('addons.tokenTitle', { name })}</h3>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5 }}>
          {t('addons.tokenDesc')}
        </p>

        {locked && (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
            {t('addons.tokenEnvLocked')}
          </p>
        )}
        {!locked && info?.unreadable && (
          <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--danger, #c0392b)' }}>
            {t('addons.tokenUnreadable')}
          </p>
        )}

        {!locked && (
          <>
            <label style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {t('addons.tokenLabel')}
              <input
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={info ? t('addons.tokenReplacePlaceholder') : ''}
                style={inputStyle}
              />
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {t('addons.tokenHeaderLabel')}
                <input
                  value={header}
                  onChange={(e) => setHeader(e.target.value)}
                  aria-describedby={hintId}
                  style={inputStyle}
                />
              </label>
              <span id={hintId} style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {t('addons.tokenHeaderHint')}
              </span>
            </div>
          </>
        )}

        {error && (
          <p role="alert" style={{ margin: 0, fontSize: 13, color: 'var(--danger, #c0392b)' }}>
            {error}
          </p>
        )}

        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          {info && !locked && (
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              style={{ ...buttonStyle, color: 'var(--danger, #c0392b)' }}
            >
              {t('addons.tokenRemove')}
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose} style={buttonStyle}>
            {locked ? t('common.close', 'Close') : t('common.cancel', 'Cancel')}
          </button>
          {!locked && (
            <button
              type="submit"
              disabled={busy || !token.trim()}
              style={{
                ...buttonStyle,
                background: 'var(--gold-dim)',
                border: 'none',
                color: 'var(--bg-deep)',
                fontWeight: 600,
              }}
            >
              {t('addons.tokenSave')}
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
