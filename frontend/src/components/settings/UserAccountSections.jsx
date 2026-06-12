import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { LuCircleCheck, LuCopy } from 'react-icons/lu'
import api, { opds } from '../../api'
import Spinner from '../Spinner'
import { useAuth } from '../../context/AuthContext'
import { useUISettings } from '../../context/UISettingsContext'

export function DisplayNameSection() {
  const { t } = useTranslation()
  const { user, refreshUser } = useAuth()
  const [value, setValue] = useState(user?.display_name ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await api.patch('/users/me/preferences', { display_name: value.trim() })
      await refreshUser()
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err?.message || t('common.save'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <h3
        style={{
          fontSize: 18,
          fontWeight: 600,
          marginBottom: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        {t('userSettings.displayName.title')}
        {saved && <LuCircleCheck size={16} style={{ color: 'var(--green)' }} />}
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
        {t('userSettings.displayName.description')}
      </p>
      <form
        onSubmit={handleSubmit}
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          maxWidth: 400,
        }}
      >
        <div style={{ flex: 1, minWidth: 180 }}>
          <label
            htmlFor="display-name"
            style={{ display: 'block', fontSize: 13, color: 'var(--text-dim)', marginBottom: 5 }}
          >
            {t('userSettings.displayName.label')}
          </label>
          <input
            id="display-name"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={user?.username}
            maxLength={100}
            style={{ width: '100%', fontSize: 14, padding: '8px 12px', boxSizing: 'border-box' }}
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          style={{
            padding: '8px 18px',
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 500,
            background: 'var(--gold-dim)',
            border: 'none',
            color: 'var(--bg-deep)',
            cursor: saving ? 'default' : 'pointer',
            opacity: saving ? 0.6 : 1,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {saving && <Spinner size={13} />}
          {saving ? t('userSettings.displayName.saving') : t('userSettings.displayName.save')}
        </button>
      </form>
      {error && <div style={{ fontSize: 13, color: '#e07070', marginTop: 8 }}>{error}</div>}
    </div>
  )
}

export function EmailSection() {
  const { t } = useTranslation()
  const { user, refreshUser } = useAuth()
  const [value, setValue] = useState(user?.email ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await api.patch('/users/me/preferences', { email: value.trim() })
      await refreshUser()
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setError(err?.message || t('userSettings.email.failed'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <h3
        style={{
          fontSize: 18,
          fontWeight: 600,
          marginBottom: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        {t('userSettings.email.title')}
        {saved && <LuCircleCheck size={16} style={{ color: 'var(--green)' }} />}
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
        {t('userSettings.email.description')}
      </p>
      <form
        onSubmit={handleSubmit}
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'flex-end',
          flexWrap: 'wrap',
          maxWidth: 460,
        }}
      >
        <div style={{ flex: 1, minWidth: 220 }}>
          <label
            htmlFor="user-email"
            style={{ display: 'block', fontSize: 13, color: 'var(--text-dim)', marginBottom: 5 }}
          >
            {t('userSettings.email.label')}
          </label>
          <input
            id="user-email"
            type="email"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('userSettings.email.placeholder')}
            maxLength={254}
            style={{ width: '100%', fontSize: 14, padding: '8px 12px', boxSizing: 'border-box' }}
          />
        </div>
        <button
          type="submit"
          disabled={saving}
          style={{
            padding: '8px 18px',
            borderRadius: 6,
            fontSize: 14,
            fontWeight: 500,
            background: 'var(--gold-dim)',
            border: 'none',
            color: 'var(--bg-deep)',
            cursor: saving ? 'default' : 'pointer',
            opacity: saving ? 0.6 : 1,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {saving && <Spinner size={13} />}
          {saving ? t('common.saving') : t('common.save')}
        </button>
      </form>
      {error && <div style={{ fontSize: 13, color: '#e07070', marginTop: 8 }}>{error}</div>}
    </div>
  )
}

export function ExplicitContentSection() {
  const { t } = useTranslation()
  const { user, refreshUser } = useAuth()
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const allowed = user?.allow_explicit ?? true

  const toggle = async () => {
    setSaving(true)
    try {
      await api.patch('/users/me/preferences', { allow_explicit: !allowed })
      await refreshUser()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <h3
        style={{
          fontSize: 18,
          fontWeight: 600,
          marginBottom: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        {t('userSettings.contentPreferences.title')}
        {saved && <LuCircleCheck size={16} style={{ color: 'var(--green)' }} />}
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
        {t('userSettings.contentPreferences.description')}
      </p>
      <label
        htmlFor="explicit-content-allowed"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          cursor: 'pointer',
          width: 'fit-content',
        }}
      >
        <input
          id="explicit-content-allowed"
          type="checkbox"
          checked={allowed}
          onChange={toggle}
          disabled={saving}
          style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--gold)' }}
        />
        <span style={{ fontSize: 14, color: 'var(--text)' }}>
          {t('userSettings.contentPreferences.showExplicit')}
        </span>
        {saving && <Spinner size={13} />}
      </label>
    </div>
  )
}

export function ChangePasswordSection() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const { disable_password_change } = useUISettings()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState(null)

  if (disable_password_change && user?.role !== 'admin') return null

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    if (next !== confirm) {
      setError(t('userSettings.changePassword.mismatch'))
      return
    }
    if (next.length < 8) {
      setError(t('userSettings.changePassword.tooShort'))
      return
    }
    setSaving(true)
    try {
      await api.patch('/users/me/password', { current_password: current, new_password: next })
      setSaved(true)
      setCurrent('')
      setNext('')
      setConfirm('')
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err?.message || t('userSettings.changePassword.failed'))
    } finally {
      setSaving(false)
    }
  }

  const fields = [
    {
      id: 'change-password-current',
      label: t('userSettings.changePassword.currentPassword'),
      value: current,
      onChange: setCurrent,
      complete: 'current-password',
    },
    {
      id: 'change-password-new',
      label: t('userSettings.changePassword.newPassword'),
      value: next,
      onChange: setNext,
      complete: 'new-password',
    },
    {
      id: 'change-password-confirm',
      label: t('userSettings.changePassword.confirmNewPassword'),
      value: confirm,
      onChange: setConfirm,
      complete: 'new-password',
    },
  ]

  return (
    <div>
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
        {t('userSettings.changePassword.title')}
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
        {t('userSettings.changePassword.description')}
      </p>

      <form
        onSubmit={handleSubmit}
        style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 360 }}
      >
        {fields.map(({ label, value, onChange, complete, id }) => (
          <div key={label}>
            <label
              htmlFor={id}
              style={{ display: 'block', fontSize: 13, color: 'var(--text-dim)', marginBottom: 5 }}
            >
              {label}
            </label>
            <input
              id={id}
              type="password"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              required
              autoComplete={complete}
              style={{ width: '100%', fontSize: 14, padding: '8px 12px', boxSizing: 'border-box' }}
            />
          </div>
        ))}

        {error && <div style={{ fontSize: 13, color: '#e07070' }}>{error}</div>}

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
          <button
            type="submit"
            disabled={saving}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 18px',
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 500,
              background: 'var(--gold-dim)',
              border: 'none',
              color: 'var(--bg-deep)',
              cursor: saving ? 'default' : 'pointer',
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving && <Spinner size={13} />}
            {saving
              ? t('userSettings.changePassword.saving')
              : t('userSettings.changePassword.updatePassword')}
          </button>
          {saved && (
            <span
              style={{
                fontSize: 13,
                color: 'var(--green)',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <LuCircleCheck size={14} /> {t('userSettings.changePassword.passwordUpdated')}
            </span>
          )}
        </div>
      </form>
    </div>
  )
}

export function OPDSSection() {
  const { t } = useTranslation()
  const [status, setStatus] = useState(null) // null = loading
  const [working, setWorking] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    opds
      .getStatus()
      .then(setStatus)
      .catch(() => setStatus({ opds_enabled: false }))
  }, [])

  const handleGenerate = async () => {
    setWorking(true)
    try {
      const next = await opds.generateToken()
      setStatus(next)
      setConfirming(false)
    } finally {
      setWorking(false)
    }
  }

  const handleRevoke = async () => {
    setWorking(true)
    try {
      const next = await opds.revokeToken()
      setStatus(next)
      setConfirming(false)
    } finally {
      setWorking(false)
    }
  }

  const handleCopy = () => {
    if (status?.feed_url) {
      navigator.clipboard.writeText(status.feed_url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  // OPDS disabled server-side — hide the section entirely
  if (status && !status.opds_enabled) return null

  return (
    <>
      <div style={{ borderTop: '1px solid var(--border)' }} />
      <div>
        <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>
          {t('userSettings.opds.title')}
        </h3>
        <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
          {t('userSettings.opds.description')}
        </p>

        {status === null ? (
          <Spinner size={16} />
        ) : !status.has_token ? (
          <button
            onClick={handleGenerate}
            disabled={working}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 18px',
              borderRadius: 6,
              fontSize: 14,
              fontWeight: 500,
              background: 'var(--gold-dim)',
              border: 'none',
              color: 'var(--bg-deep)',
              cursor: working ? 'default' : 'pointer',
              opacity: working ? 0.6 : 1,
            }}
          >
            {working && <Spinner size={13} />}
            {working ? t('userSettings.opds.generating') : t('userSettings.opds.enable')}
          </button>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Feed URL display */}
            <div>
              <label
                htmlFor="opds-feed-url"
                style={{
                  display: 'block',
                  fontSize: 13,
                  color: 'var(--text-dim)',
                  marginBottom: 5,
                }}
              >
                {t('userSettings.opds.feedUrl')}
              </label>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  id="opds-feed-url"
                  readOnly
                  value={status.feed_url || ''}
                  style={{
                    flex: 1,
                    minWidth: 200,
                    fontSize: 13,
                    padding: '7px 10px',
                    boxSizing: 'border-box',
                    color: 'var(--text-dim)',
                  }}
                  onFocus={(e) => e.target.select()}
                />
                <button
                  onClick={handleCopy}
                  title={t('userSettings.opds.copy')}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '7px 12px',
                    borderRadius: 6,
                    fontSize: 13,
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    color: copied ? 'var(--green)' : 'var(--text-dim)',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {copied ? (
                    <>
                      <LuCircleCheck size={14} /> {t('userSettings.opds.copied')}
                    </>
                  ) : (
                    <>
                      <LuCopy size={14} /> {t('userSettings.opds.copy')}
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Actions */}
            {!confirming ? (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  onClick={handleGenerate}
                  disabled={working}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '7px 14px',
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 500,
                    background: 'var(--gold-dim)',
                    border: 'none',
                    color: 'var(--bg-deep)',
                    cursor: working ? 'default' : 'pointer',
                    opacity: working ? 0.6 : 1,
                  }}
                >
                  {working && <Spinner size={12} />}
                  {t('userSettings.opds.regenerate')}
                </button>
                <button
                  onClick={() => setConfirming(true)}
                  disabled={working}
                  style={{
                    padding: '7px 14px',
                    borderRadius: 6,
                    fontSize: 13,
                    background: 'rgba(180,60,60,0.12)',
                    border: '1px solid rgba(180,60,60,0.4)',
                    color: '#e07070',
                    cursor: 'pointer',
                  }}
                >
                  {t('userSettings.opds.disable')}
                </button>
              </div>
            ) : (
              <div
                style={{
                  padding: '14px 16px',
                  borderRadius: 8,
                  background: 'rgba(180,60,60,0.08)',
                  border: '1px solid rgba(180,60,60,0.4)',
                  maxWidth: 420,
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 10 }}>
                  {t('userSettings.opds.confirmRevoke')}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={handleRevoke}
                    disabled={working}
                    style={{
                      padding: '7px 14px',
                      borderRadius: 6,
                      fontSize: 13,
                      fontWeight: 500,
                      background: 'rgba(180,60,60,0.8)',
                      border: 'none',
                      color: '#fff',
                      cursor: working ? 'default' : 'pointer',
                      opacity: working ? 0.6 : 1,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    {working && <Spinner size={12} />}
                    {t('userSettings.opds.confirmDisable')}
                  </button>
                  <button
                    onClick={() => setConfirming(false)}
                    disabled={working}
                    style={{
                      padding: '7px 14px',
                      borderRadius: 6,
                      fontSize: 13,
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
          </div>
        )}
      </div>
    </>
  )
}

export function DeleteAccountSection({ user, onLogout }) {
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
      <h3 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6, color: '#e07070' }}>
        {t('userSettings.deleteAccount.title')}
      </h3>
      <p style={{ fontSize: 14, color: 'var(--text-dim)', marginBottom: 20, lineHeight: 1.6 }}>
        {t('userSettings.deleteAccount.description')}
        {isAdmin && (
          <>
            <br />
            <span style={{ color: '#e07070' }}>{t('userSettings.deleteAccount.adminWarning')}</span>
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
            color: isAdmin ? 'var(--text-muted)' : '#e07070',
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
                background: 'rgba(180,60,60,0.8)',
                border: 'none',
                color: '#fff',
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
          {error && <div style={{ fontSize: 13, color: '#e07070', marginTop: 10 }}>{error}</div>}
        </div>
      )}
    </div>
  )
}
