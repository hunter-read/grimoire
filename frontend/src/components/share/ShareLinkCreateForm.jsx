import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { shareLinks } from '../../api'
import { EXPIRY_OPTIONS } from './shareLinkUtils'

const inputStyle = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '6px 10px',
  fontSize: 13,
  background: 'var(--bg-input)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text)',
}
const labelStyle = { fontSize: 12, fontWeight: 500, display: 'block', marginBottom: 4 }

/** Creates a share link for one item: an optional label, expiry and password. */
export default function ShareLinkCreateForm({ resourceType, resourceId, onCreated }) {
  const { t } = useTranslation()
  const [label, setLabel] = useState('')
  const [expiry, setExpiry] = useState('7')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const tooShort = password.length > 0 && password.length < 4

  const submit = async (e) => {
    e.preventDefault()
    if (tooShort) return
    setBusy(true)
    setError('')
    try {
      const link = await shareLinks.create({
        resource_type: resourceType,
        resource_id: resourceId,
        label: label.trim(),
        expires_in_days: expiry ? Number(expiry) : null,
        ...(password ? { password } : {}),
      })
      setLabel('')
      setPassword('')
      onCreated(link)
    } catch (err) {
      setError(err.message || t('share.createFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12,
        }}
      >
        <label>
          <span style={labelStyle}>{t('share.form.label')}</span>
          <input
            value={label}
            maxLength={200}
            placeholder={t('share.form.labelPlaceholder')}
            onChange={(e) => setLabel(e.target.value)}
            style={inputStyle}
          />
        </label>
        <label>
          <span style={labelStyle}>{t('share.form.expiry')}</span>
          <select value={expiry} onChange={(e) => setExpiry(e.target.value)} style={inputStyle}>
            {EXPIRY_OPTIONS.map((o) => (
              <option key={o.key} value={o.value}>
                {t(`share.expiry.${o.key}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        <span style={labelStyle}>{t('share.form.password')}</span>
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          maxLength={200}
          placeholder={t('share.form.passwordPlaceholder')}
          aria-invalid={tooShort ? 'true' : undefined}
          onChange={(e) => setPassword(e.target.value)}
          style={inputStyle}
        />
        <span style={{ fontSize: 12, color: tooShort ? 'var(--warning)' : 'var(--text-muted)' }}>
          {tooShort ? t('share.form.passwordTooShort') : t('share.form.passwordHint')}
        </span>
      </label>
      {error && (
        <p role="alert" style={{ fontSize: 13, color: 'var(--danger)', margin: 0 }}>
          {error}
        </p>
      )}
      <div>
        <button
          type="submit"
          disabled={busy || tooShort}
          style={{
            padding: '7px 14px',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 500,
            background: 'var(--gold-dim)',
            color: 'var(--bg-deep)',
            border: '1px solid var(--gold-dim)',
            cursor: busy ? 'wait' : 'pointer',
            opacity: busy || tooShort ? 0.6 : 1,
          }}
        >
          {t('share.form.create')}
        </button>
      </div>
    </form>
  )
}
